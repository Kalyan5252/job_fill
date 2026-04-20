(function initJobAutofillContentScript() {
  const BUTTON_ID = "job-autofill-agent-button";
  const TOAST_ID = "job-autofill-agent-toast";
  const DATA_FIELD_ID_ATTR = "data-job-autofill-id";
  const DATA_GROUP_ID_ATTR = "data-job-autofill-group";
  let fieldIdCounter = 1;
  let groupIdCounter = 1;
  let lastExtractedFieldIndex = {};

  function log(...args) {
    console.log("[JobAutofill:content]", ...args);
  }

  function createFloatingButton() {
    if (document.getElementById(BUTTON_ID)) {
      return;
    }

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.title = "Run Autofill";
    button.setAttribute("aria-label", "Run Autofill");
    button.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="#ffffff" d="M3 17.25V21h3.75l11-11-3.75-3.75-11 11zM20.71 7.04a1.003 1.003 0 000-1.42L18.37 3.29a1.003 1.003 0 00-1.42 0L15.13 5.1l3.75 3.75 1.83-1.81z"/>
      </svg>
    `;

    Object.assign(button.style, {
      position: "fixed",
      right: "0",
      top: "45%",
      transform: "translateY(-50%)",
      zIndex: "2147483647",
      width: "64px",
      height: "56px",
      padding: "0",
      border: "none",
      cursor: "pointer",
      background: "linear-gradient(160deg, #2fbf71 0%, #119d57 100%)",
      color: "#ffffff",
      boxShadow: "0 10px 24px rgba(8, 85, 45, 0.35)",
      borderRadius: "999px 0 0 999px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      transition: "transform 0.2s ease, filter 0.2s ease, width 0.2s ease"
    });

    button.addEventListener("mouseenter", () => {
      button.style.filter = "brightness(1.06)";
      button.style.width = "72px";
    });

    button.addEventListener("mouseleave", () => {
      button.style.filter = "brightness(1)";
      button.style.width = "64px";
    });

    button.addEventListener("click", runAutofill);
    document.body.appendChild(button);
  }

  function showToast(message, isError = false) {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = TOAST_ID;
      Object.assign(toast.style, {
        position: "fixed",
        left: "20px",
        bottom: "20px",
        zIndex: "2147483647",
        padding: "10px 14px",
        borderRadius: "10px",
        color: "white",
        fontSize: "13px",
        maxWidth: "450px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        boxShadow: "0 6px 16px rgba(0,0,0,0.2)",
        transition: "opacity 0.2s ease"
      });
      document.body.appendChild(toast);
    }

    toast.style.background = isError ? "#b3261e" : "#137333";
    toast.innerText = message;
    toast.style.opacity = "1";

    window.clearTimeout(toast.__hideTimer);
    toast.__hideTimer = window.setTimeout(() => {
      toast.style.opacity = "0";
    }, 3600);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "TRIGGER_AUTOFILL") {
      runAutofill().finally(() => sendResponse?.({ ok: true }));
      return true;
    }
  });

  document.addEventListener("keydown", (event) => {
    const key = (event.key || "").toLowerCase();
    const cmdShiftF = event.metaKey && event.shiftKey && key === "f";
    if (!cmdShiftF) {
      return;
    }

    const target = event.target;
    const isTypingTarget =
      target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement
      || (target && target.isContentEditable);

    // Avoid hijacking user typing shortcuts inside inputs/editors.
    if (isTypingTarget) {
      return;
    }

    event.preventDefault();
    runAutofill();
  }, true);

  async function runAutofill() {
    try {
      const formFields = extractFormFields();
      lastExtractedFieldIndex = indexFieldsBySelector(formFields);
      if (formFields.length === 0) {
        showToast("No fillable form fields detected on this page.", true);
        return;
      }

      showToast(`Detected ${formFields.length} fields. Getting mapping...`);

      const response = await sendMessage({
        type: "AUTOFILL_REQUEST",
        payload: {
          formFields,
          pageUrl: window.location.href,
          pageTitle: document.title
        }
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Autofill request failed");
      }

      const mapping = response.mapping || {};
      const fillResult = await applyMappingWithRetries(mapping, 5, 600);
      const correctionResult = await autoCorrectAssignedFields(mapping);

      let fileResult = { attached: 0, skipped: 0 };
      const hasFileAttachments = response.fileAttachments && Object.keys(response.fileAttachments).length > 0;
      if (hasFileAttachments) {
        const attachResp = await sendMessage({
          type: "ATTACH_FILES_REQUEST",
          payload: { fileAttachments: response.fileAttachments }
        });

        if (attachResp?.ok) {
          fileResult = {
            attached: attachResp.attached || 0,
            skipped: attachResp.skipped || 0
          };
        }
      }

      showToast(
        `Filled ${fillResult.filled}, corrected ${correctionResult.corrected}, unresolved ${correctionResult.unresolved}, files attached ${fileResult.attached}. Source: ${response.source}`
      );
    } catch (error) {
      log("Autofill failed", error);
      showToast(`Autofill failed: ${error.message || "Unknown error"}`, true);
    }
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (resp) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        resolve(resp);
      });
    });
  }

  function extractFormFields() {
    const elements = Array.from(document.querySelectorAll("input, textarea, select"));
    const fields = [];
    const processedRadioGroups = new Set();
    const processedCheckboxGroups = new Set();

    for (const element of elements) {
      if (!isEligibleField(element)) {
        continue;
      }

      const tag = element.tagName.toLowerCase();
      const type = (element.getAttribute("type") || "").toLowerCase();

      if (type === "radio" && element.name) {
        const groupKey = createGroupKey(element, "radio");
        if (!processedRadioGroups.has(groupKey)) {
          processedRadioGroups.add(groupKey);
          fields.push(buildGroupedChoiceField(element, "radio"));
        }
        continue;
      }

      if (type === "checkbox" && element.name) {
        const sameNameBoxes = getGroupElements(element, "checkbox");
        if (sameNameBoxes.length > 1) {
          const groupKey = createGroupKey(element, "checkbox");
          if (!processedCheckboxGroups.has(groupKey)) {
            processedCheckboxGroups.add(groupKey);
            fields.push(buildGroupedChoiceField(element, "checkbox"));
          }
          continue;
        }
      }

      const selector = assignFieldSelector(element);
      if (!selector) {
        continue;
      }

      const options = tag === "select"
        ? Array.from(element.options).map((option) => ({
            value: option.value,
            text: option.textContent?.trim() || ""
          }))
        : [];

      fields.push({
        selector,
        tag,
        type,
        name: element.getAttribute("name") || "",
        id: element.id || "",
        label: findLabel(element),
        placeholder: element.getAttribute("placeholder") || "",
        ariaLabel: element.getAttribute("aria-label") || "",
        required: element.required,
        options
      });
    }

    return fields;
  }

  function buildGroupedChoiceField(element, inputType) {
    const groupElements = getGroupElements(element, inputType).filter(isEligibleField);
    const groupSelector = assignGroupSelector(groupElements);
    const label = findLabel(element) || findGroupLabel(groupElements);

    return {
      selector: groupSelector,
      tag: "input",
      type: inputType,
      name: element.name || "",
      id: "",
      label,
      placeholder: "",
      ariaLabel: element.getAttribute("aria-label") || "",
      required: groupElements.some((x) => x.required),
      options: groupElements.map((opt) => ({
        value: opt.value || "",
        text: findOptionLabel(opt) || opt.value || ""
      }))
    };
  }

  function indexFieldsBySelector(fields) {
    const index = {};
    for (const field of fields) {
      if (field?.selector) {
        index[field.selector] = field;
      }
    }
    return index;
  }

  function assignFieldSelector(element) {
    let id = element.getAttribute(DATA_FIELD_ID_ATTR);
    if (!id) {
      id = `f${fieldIdCounter++}`;
      element.setAttribute(DATA_FIELD_ID_ATTR, id);
    }
    return `[${DATA_FIELD_ID_ATTR}="${id}"]`;
  }

  function assignGroupSelector(groupElements) {
    if (!Array.isArray(groupElements) || groupElements.length === 0) {
      return "";
    }

    let groupId = groupElements[0].getAttribute(DATA_GROUP_ID_ATTR);
    if (!groupId) {
      groupId = `g${groupIdCounter++}`;
      for (const element of groupElements) {
        element.setAttribute(DATA_GROUP_ID_ATTR, groupId);
      }
    }

    return `input[${DATA_GROUP_ID_ATTR}="${groupId}"]`;
  }

  function getScopePrefix(element) {
    const form = element.closest("form");
    if (!form) {
      return "";
    }

    const formSelector = buildUniqueSelector(form);
    if (!formSelector) {
      return "";
    }

    return `${formSelector} `;
  }

  function getGroupElements(element, inputType) {
    const form = element.closest("form");
    const root = form || document;
    const safeName = CSS.escape(element.name || "");
    return Array.from(root.querySelectorAll(`input[type="${inputType}"][name="${safeName}"]`));
  }

  function createGroupKey(element, inputType) {
    const formSelector = getScopePrefix(element);
    return `${inputType}|${formSelector}|${element.name || ""}`;
  }

  function isEligibleField(element) {
    const tag = element.tagName.toLowerCase();
    const type = (element.getAttribute("type") || "").toLowerCase();

    if (element.disabled || element.readOnly) return false;
    if (tag === "input" && ["hidden", "submit", "reset", "button", "image"].includes(type)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }

    return true;
  }

  function findGroupLabel(groupElements) {
    for (const el of groupElements) {
      const label = findLabel(el);
      if (label) return label;
    }
    return "";
  }

  function findOptionLabel(element) {
    if (element.labels && element.labels.length > 0) {
      return cleanText(element.labels[0].textContent);
    }

    const parentLabel = element.closest("label");
    if (parentLabel) {
      return cleanText(parentLabel.textContent);
    }

    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const labelNode = document.getElementById(labelledBy);
      if (labelNode) return cleanText(labelNode.textContent);
    }

    return "";
  }

  function findLabel(element) {
    if (element.labels && element.labels.length > 0) {
      return cleanText(element.labels[0].textContent);
    }

    if (element.id) {
      const explicit = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
      if (explicit) return cleanText(explicit.textContent);
    }

    const parentLabel = element.closest("label");
    if (parentLabel) {
      return cleanText(parentLabel.textContent);
    }

    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) return cleanText(ariaLabel);

    const ariaLabelledBy = element.getAttribute("aria-labelledby");
    if (ariaLabelledBy) {
      const labelNode = document.getElementById(ariaLabelledBy);
      if (labelNode) return cleanText(labelNode.textContent);
    }

    const formGroup = element.closest(".form-group, .field, .input-group, [class*='form']");
    if (formGroup) {
      const nearbyLabel = formGroup.querySelector("label, legend");
      if (nearbyLabel) return cleanText(nearbyLabel.textContent);
    }

    const prev = element.previousElementSibling;
    if (prev && ["label", "legend"].includes(prev.tagName.toLowerCase())) {
      return cleanText(prev.textContent);
    }

    return "";
  }

  function cleanText(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function buildUniqueSelector(element) {
    if (element.id) {
      return `#${CSS.escape(element.id)}`;
    }

    const parts = [];
    let node = element;

    while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body) {
      let part = node.nodeName.toLowerCase();

      if (node.getAttribute("name")) {
        part += `[name="${CSS.escape(node.getAttribute("name"))}"]`;
        parts.unshift(part);
        break;
      }

      const siblings = node.parentNode
        ? Array.from(node.parentNode.children).filter((sib) => sib.nodeName === node.nodeName)
        : [];
      if (siblings.length > 1) {
        const index = siblings.indexOf(node) + 1;
        part += `:nth-of-type(${index})`;
      }

      parts.unshift(part);
      node = node.parentElement;
    }

    return parts.join(" > ");
  }

  async function applyMappingWithRetries(mapping, attempts, intervalMs) {
    let best = { filled: 0, skipped: 0 };
    for (let i = 0; i < attempts; i += 1) {
      const current = applyMapping(mapping);
      if (current.filled >= Object.keys(mapping).length) {
        return current;
      }
      best = current.filled >= best.filled ? current : best;
      await wait(intervalMs);
    }
    return best;
  }

  function applyMapping(mapping) {
    let filled = 0;
    let skipped = 0;

    for (const [selector, value] of Object.entries(mapping || {})) {
      let element = document.querySelector(selector);
      if (!element) {
        element = findElementByFieldDescriptor(lastExtractedFieldIndex[selector]);
      }
      if (!element) {
        skipped += 1;
        continue;
      }

      const success = setElementValue(element, value, selector);
      if (success) {
        filled += 1;
      } else {
        skipped += 1;
      }
    }

    return { filled, skipped };
  }

  async function autoCorrectAssignedFields(mapping) {
    let corrected = 0;
    let unresolved = 0;

    for (const [selector, rawValue] of Object.entries(mapping || {})) {
      if (rawValue === undefined || rawValue === null || rawValue === "__SKIP__") {
        continue;
      }

      const value = String(rawValue);
      const field = lastExtractedFieldIndex[selector];
      let element = document.querySelector(selector);
      if (!element) {
        element = findElementByFieldDescriptor(field);
      }
      if (!element) {
        unresolved += 1;
        continue;
      }

      if (isFieldSatisfied(element, value)) {
        continue;
      }

      const fixed = await forceFixField(element, value, selector);
      if (fixed) {
        corrected += 1;
      } else {
        unresolved += 1;
      }
    }

    return { corrected, unresolved };
  }

  async function forceFixField(element, value, selector) {
    const type = (element.getAttribute("type") || "").toLowerCase();
    const field = lastExtractedFieldIndex[selector];

    if (type === "file") {
      return false;
    }

    // Retry with progressively stronger event strategies.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (type === "checkbox" || type === "radio") {
        setElementValue(element, value, selector);
      } else if (element.tagName.toLowerCase() === "select") {
        setElementValue(element, value, selector);
      } else {
        const normalizedValue = normalizeForField(value, field, element);
        setTextLikeValue(element, normalizedValue);
        commitInputLikeUser(element, normalizedValue);
      }

      await wait(80);
      if (isFieldSatisfied(element, value)) {
        return true;
      }
    }

    return false;
  }

  function isFieldSatisfied(element, expectedValue) {
    const tag = element.tagName.toLowerCase();
    const type = (element.getAttribute("type") || "").toLowerCase();

    if (type === "checkbox" || type === "radio") {
      return !!element.checked;
    }

    if (tag === "select") {
      return !!element.value;
    }

    const actual = (element.value || "").trim();
    if (!actual) return false;

    if (type === "url") {
      return isLikelyValidUrl(actual);
    }

    if (element.required && typeof element.checkValidity === "function") {
      return element.checkValidity();
    }

    return true;
  }

  function normalizeForField(value, field, element) {
    const text = String(value || "").trim();
    const haystack = normalize([
      field?.label,
      field?.name,
      field?.placeholder,
      field?.ariaLabel,
      element.getAttribute("aria-label"),
      element.getAttribute("name"),
      element.id
    ].filter(Boolean).join(" "));

    if (haystack.includes("linkedin")) {
      if (/^https?:\/\//i.test(text)) return text;
      return `https://${text.replace(/^\/+/, "")}`;
    }

    return text;
  }

  function commitInputLikeUser(element, finalValue) {
    element.focus();
    setNativeInputValue(element, finalValue);
    dispatchInputEvent(element, finalValue.slice(-1), "insertReplacementText");
    element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    element.dispatchEvent(new KeyboardEvent("keyup", { key: "Tab", bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));

    const form = element.closest("form");
    if (form) {
      form.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function isLikelyValidUrl(text) {
    try {
      const value = String(text || "").trim();
      if (!value) return false;
      const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
      const url = new URL(withProtocol);
      return !!url.hostname;
    } catch (_error) {
      return false;
    }
  }

  function findElementByFieldDescriptor(field) {
    if (!field) return null;

    const type = normalize(field.type);
    const name = field.name || "";
    const id = field.id || "";
    const label = normalize(field.label);
    const placeholder = normalize(field.placeholder);
    const ariaLabel = normalize(field.ariaLabel);

    if ((type === "radio" || type === "checkbox") && name) {
      const candidates = Array.from(document.querySelectorAll(`input[type="${type}"][name="${CSS.escape(name)}"]`));
      return candidates.find(isEligibleField) || null;
    }

    if (id) {
      const byId = document.getElementById(id);
      if (byId && isEligibleField(byId)) return byId;
    }

    if (name) {
      const byName = Array.from(document.querySelectorAll(`[name="${CSS.escape(name)}"]`)).find(isEligibleField);
      if (byName) return byName;
    }

    const candidates = Array.from(document.querySelectorAll("input, textarea, select")).filter(isEligibleField);
    return candidates.find((el) => {
      const elLabel = normalize(findLabel(el));
      const elPlaceholder = normalize(el.getAttribute("placeholder") || "");
      const elAria = normalize(el.getAttribute("aria-label") || "");
      return (label && elLabel === label)
        || (placeholder && elPlaceholder === placeholder)
        || (ariaLabel && elAria === ariaLabel);
    }) || null;
  }

  function setElementValue(element, value, selector) {
    if (value === undefined || value === null || value === "__SKIP__") {
      return false;
    }

    const tag = element.tagName.toLowerCase();
    const type = (element.getAttribute("type") || "").toLowerCase();

    if (type === "file") {
      return false;
    }

    if (tag === "select") {
      return setSelectValue(element, String(value));
    }

    if (type === "checkbox") {
      return setCheckboxValue(selector, element, value);
    }

    if (type === "radio") {
      return setRadioValue(selector, element, value);
    }

    setTextLikeValue(element, String(value));
    if (looksLikeCombobox(element)) {
      finalizeComboboxInput(element);
    }
    return true;
  }

  function setCheckboxValue(selector, element, value) {
    const group = getChoiceGroup(selector, "checkbox", element.name);
    if (group.length <= 1) {
      const boolValue = toBoolean(value);
      if (typeof boolValue !== "boolean") return false;
      element.checked = boolValue;
      dispatchStandardEvents(element);
      return true;
    }

    const targets = normalizeChoiceTargets(value);
    let changed = 0;
    for (const option of group) {
      const optionKey1 = normalize(option.value);
      const optionKey2 = normalize(findOptionLabel(option));
      option.checked = targets.has(optionKey1) || targets.has(optionKey2);
      dispatchStandardEvents(option);
      changed += 1;
    }
    return changed > 0;
  }

  function setRadioValue(selector, element, value) {
    const group = getChoiceGroup(selector, "radio", element.name);
    const target = normalize(String(value));

    for (const option of group) {
      const optionKey1 = normalize(option.value);
      const optionKey2 = normalize(findOptionLabel(option));
      if (optionKey1 === target || optionKey2 === target || optionKey2.includes(target)) {
        option.checked = true;
        dispatchStandardEvents(option);
        return true;
      }
    }

    return false;
  }

  function getChoiceGroup(selector, inputType, fallbackName) {
    let group = Array.from(document.querySelectorAll(selector));
    if (group.length > 0) return group;

    if (fallbackName) {
      const safeName = CSS.escape(fallbackName);
      group = Array.from(document.querySelectorAll(`input[type="${inputType}"][name="${safeName}"]`));
    }

    return group;
  }

  function normalizeChoiceTargets(value) {
    if (Array.isArray(value)) {
      return new Set(value.map((x) => normalize(String(x))));
    }

    const text = String(value);
    const parts = text.split(/[|,]/g).map((x) => normalize(x)).filter(Boolean);
    if (parts.length > 0) {
      return new Set(parts);
    }

    return new Set([normalize(text)]);
  }

  function setSelectValue(select, rawValue) {
    const target = normalize(rawValue);
    const options = Array.from(select.options || []);

    const match = options.find((opt) => normalize(opt.value) === target)
      || options.find((opt) => normalize(opt.textContent) === target)
      || options.find((opt) => normalize(opt.textContent).includes(target));

    if (!match) {
      return false;
    }

    select.value = match.value;
    dispatchStandardEvents(select);
    return true;
  }

  function setNativeInputValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;

    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor?.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
  }

  function setTextLikeValue(element, value) {
    element.focus();

    // Clear first so validation libraries detect a fresh user-like edit cycle.
    setNativeInputValue(element, "");
    dispatchInputEvent(element, "", "deleteContentBackward");

    let current = "";
    for (const ch of value) {
      current += ch;
      dispatchKeyboardEvent(element, "keydown", ch);
      dispatchKeyboardEvent(element, "keypress", ch);
      setNativeInputValue(element, current);
      dispatchInputEvent(element, ch, "insertText");
      dispatchKeyboardEvent(element, "keyup", ch);
    }

    dispatchStandardEvents(element);
  }

  function dispatchStandardEvents(element) {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function dispatchInputEvent(element, data, inputType) {
    try {
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        composed: true,
        data,
        inputType
      }));
    } catch (_error) {
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function dispatchKeyboardEvent(element, type, key) {
    try {
      element.dispatchEvent(new KeyboardEvent(type, {
        key,
        bubbles: true,
        composed: true
      }));
    } catch (_error) {
      // no-op for browsers that restrict synthetic keyboard events
    }
  }

  function looksLikeCombobox(element) {
    const role = (element.getAttribute("role") || "").toLowerCase();
    const ariaAutocomplete = (element.getAttribute("aria-autocomplete") || "").toLowerCase();
    const ariaHasPopup = (element.getAttribute("aria-haspopup") || "").toLowerCase();
    const hasList = !!element.getAttribute("list");

    return role === "combobox"
      || ariaAutocomplete === "list"
      || ariaAutocomplete === "both"
      || ariaHasPopup === "listbox"
      || hasList;
  }

  function finalizeComboboxInput(element) {
    try {
      element.focus();
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      element.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowDown", bubbles: true }));
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      element.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new Event("blur", { bubbles: true }));
    } catch (error) {
      log("Combobox finalize failed", error);
    }
  }

  function normalize(text) {
    return (text || "").toString().trim().toLowerCase();
  }

  function toBoolean(value) {
    if (typeof value === "boolean") return value;
    const normalized = normalize(String(value));
    if (["yes", "true", "1", "checked", "on"].includes(normalized)) return true;
    if (["no", "false", "0", "unchecked", "off"].includes(normalized)) return false;
    return null;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createFloatingButton);
  } else {
    createFloatingButton();
  }

  const observer = new MutationObserver(() => {
    if (!document.getElementById(BUTTON_ID)) {
      createFloatingButton();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();

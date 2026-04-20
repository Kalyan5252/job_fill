const DEFAULT_API_BASE_URL = "http://localhost:4000";
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_RETRY_COUNT = 3;

const FALLBACK_PROFILE = {
  fullName: "Kalyan Pendem",
  preferredName: "Kalyan",
  firstName: "Kalyan",
  lastName: "Pendem",
  email: "kalyanpendem007@gmail.com",
  phone: "+91 9381034364",
  currentCompany: "N/A",
  currentTitle: "Full Stack Developer",
  linkedin: "https://www.linkedin.com/in/kalyanpendem/",
  github: "https://github.com/Kalyan5252",
  location: "Andhra Pradesh, India",
  addressLine1: "AnnapurnaNagar, 1st line, Guntur",
  addressLine2: "Guntur",
  city: "Guntur",
  state: "Andhra Pradesh",
  country: "India",
  skills: ["TypeScript", "JavaScript", "Node.js", "React", "MongoDB", "PostgreSQL"],
  yearsOfExperience: "0"
};

function log(...args) {
  console.log("[JobAutofill:background]", ...args);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "job-autofill-run",
    title: "Auto Fill Form",
    contexts: ["page", "editable"]
  });

  chrome.storage.local.set({
    apiBaseUrl: DEFAULT_API_BASE_URL,
    retryCount: DEFAULT_RETRY_COUNT,
    requestTimeoutMs: DEFAULT_TIMEOUT_MS,
    enableBackend: true
  });

  log("Extension installed and defaults initialized.");
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "job-autofill-run" || !tab?.id) {
    return;
  }

  triggerAutofillInTab(tab.id);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "trigger-autofill") {
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    log("No active tab found for keyboard shortcut.");
    return;
  }

  triggerAutofillInTab(tab.id);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) {
    return;
  }

  if (message.type === "AUTOFILL_REQUEST") {
    handleAutofillRequest(message.payload)
      .then((data) => sendResponse({ ok: true, ...data }))
      .catch((error) => {
        log("AUTOFILL_REQUEST failed", error);
        sendResponse({
          ok: false,
          error: error?.message || "Unknown autofill error"
        });
      });
    return true;
  }

  if (message.type === "ATTACH_FILES_REQUEST") {
    const tabId = sender?.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: "Missing sender tab id" });
      return true;
    }

    attachFilesToTab(tabId, message.payload?.fileAttachments || {})
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        log("ATTACH_FILES_REQUEST failed", error);
        sendResponse({ ok: false, error: error?.message || "File attachment failed" });
      });

    return true;
  }

  if (message.type === "SET_AUTH_TOKEN") {
    chrome.storage.local.set({ authToken: message.payload?.token || null }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === "SET_API_BASE") {
    chrome.storage.local.set({ apiBaseUrl: message.payload?.apiBaseUrl || DEFAULT_API_BASE_URL }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }
});

async function handleAutofillRequest(payload) {
  const { formFields = [] } = payload || {};
  const storage = await chrome.storage.local.get([
    "authToken",
    "apiBaseUrl",
    "retryCount",
    "requestTimeoutMs",
    "enableBackend",
    "userProfile"
  ]);

  const authToken = storage.authToken;
  const apiBaseUrl = storage.apiBaseUrl || DEFAULT_API_BASE_URL;
  const retryCount = Number.isInteger(storage.retryCount) ? storage.retryCount : DEFAULT_RETRY_COUNT;
  const requestTimeoutMs = Number.isInteger(storage.requestTimeoutMs) ? storage.requestTimeoutMs : DEFAULT_TIMEOUT_MS;
  const enableBackend = storage.enableBackend !== false;
  const savedLocalProfile = isNonEmptyObject(storage.userProfile) ? storage.userProfile : null;
  const fallbackProfile = FALLBACK_PROFILE;

  if (!enableBackend) {
    log("Backend disabled, using local fallback mapper.");
    return {
      source: "local-fallback",
      mapping: createLocalMapping(formFields, savedLocalProfile || fallbackProfile),
      fileAttachments: createLocalFileAttachments(formFields)
    };
  }

  try {
    const shouldSendUserProfile = !authToken;

    const requestBody = {
      formFields,
      ...(shouldSendUserProfile ? { userProfile: savedLocalProfile || fallbackProfile } : {}),
      meta: {
        pageUrl: payload?.pageUrl || "",
        pageTitle: payload?.pageTitle || ""
      }
    };

    let data;
    try {
      data = await fetchWithRetry(
        `${apiBaseUrl.replace(/\/$/, "")}/api/autofill`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
          },
          body: JSON.stringify(requestBody)
        },
        { retries: retryCount, timeoutMs: requestTimeoutMs }
      );
    } catch (primaryError) {
      // Deployed backend may have a different JWT secret or user DB.
      // Auto-recover by retrying once without auth for single-user fallback mode.
      if (authToken && isAuthError(primaryError)) {
        log("Auth token rejected. Clearing stale token and retrying unauthenticated once.");
        await chrome.storage.local.set({ authToken: null });

        data = await fetchWithRetry(
          `${apiBaseUrl.replace(/\/$/, "")}/api/autofill`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              formFields,
              ...(savedLocalProfile ? { userProfile: savedLocalProfile } : {}),
              meta: {
                pageUrl: payload?.pageUrl || "",
                pageTitle: payload?.pageTitle || ""
              }
            })
          },
          { retries: retryCount, timeoutMs: requestTimeoutMs }
        );
      } else {
        throw primaryError;
      }
    }

    if (!data?.mapping || typeof data.mapping !== "object") {
      throw new Error("Invalid response from backend autofill API");
    }

    return {
      source: "backend",
      mapping: data.mapping,
      fileAttachments: data.fileAttachments && typeof data.fileAttachments === "object" ? data.fileAttachments : {}
    };
  } catch (error) {
    if (authToken) {
      log("Backend autofill failed for authenticated request", error?.message);
      throw new Error(`Authenticated autofill failed: ${error?.message || "backend error"}`);
    }

    log("Backend autofill failed, applying unauthenticated fallback mapping", error?.message);
    return {
      source: "local-fallback-after-error",
      mapping: createLocalMapping(formFields, savedLocalProfile || fallbackProfile),
      fileAttachments: createLocalFileAttachments(formFields)
    };
  }
}

async function fetchWithRetry(url, options, { retries = 3, timeoutMs = 15000 } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorBody = await safeJson(response);
        const message = errorBody?.message || `HTTP ${response.status}`;
        throw new Error(message);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      const shouldRetry = attempt < retries;
      if (!shouldRetry) break;

      const delay = 300 * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }

  throw lastError;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch (_) {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createLocalMapping(formFields, profile) {
  const mapping = {};
  for (const field of formFields) {
    const haystack = [field.label, field.placeholder, field.name, field.id, field.selector, field.type]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const value =
      guessIfIncludes(haystack, ["preferred name", "nickname", "display name"]) ? (profile.preferredName || profile.firstName) :
      guessIfIncludes(haystack, ["full name", "name"]) ? profile.fullName :
      guessIfIncludes(haystack, ["first name", "given name"]) ? profile.firstName :
      guessIfIncludes(haystack, ["last name", "surname", "family name"]) ? profile.lastName :
      guessIfIncludes(haystack, ["email", "e-mail"]) ? profile.email :
      guessIfIncludes(haystack, ["phone", "mobile", "contact number"]) ? profile.phone :
      guessIfIncludes(haystack, ["linkedin"]) ? profile.linkedin :
      guessIfIncludes(haystack, ["github"]) ? profile.github :
      guessIfIncludes(haystack, ["address line 1", "street", "address1"]) ? profile.addressLine1 :
      guessIfIncludes(haystack, ["address line 2", "address2", "apartment"]) ? profile.addressLine2 :
      guessIfIncludes(haystack, ["city"]) ? profile.city :
      guessIfIncludes(haystack, ["state", "province", "region"]) ? profile.state :
      guessIfIncludes(haystack, ["country"]) ? profile.country :
      guessIfIncludes(haystack, ["location"]) ? profile.location :
      guessIfIncludes(haystack, ["title", "position", "role"]) ? profile.currentTitle :
      null;

    if (value) {
      mapping[field.selector] = value;
    }
  }

  return mapping;
}

function createLocalFileAttachments(formFields) {
  const fileAttachments = {};

  for (const field of formFields) {
    if ((field.type || "").toLowerCase() === "file") {
      fileAttachments[field.selector] = "";
    }
  }

  return fileAttachments;
}

function guessIfIncludes(haystack, keywords) {
  return keywords.some((keyword) => haystack.includes(keyword));
}

function isNonEmptyObject(value) {
  return !!value && typeof value === "object" && Object.keys(value).length > 0;
}

function isAuthError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("401")
    || message.includes("unauthorized")
    || message.includes("invalid auth token")
    || message.includes("missing auth token")
    || message.includes("jwt");
}

function triggerAutofillInTab(tabId) {
  chrome.tabs.sendMessage(tabId, { type: "TRIGGER_AUTOFILL" }, () => {
    if (chrome.runtime.lastError) {
      const msg = chrome.runtime.lastError.message || "";
      log("Could not send TRIGGER_AUTOFILL:", msg);
      // If content script is not attached yet, inject and retry once.
      if (msg.includes("Receiving end does not exist")) {
        chrome.scripting.executeScript(
          {
            target: { tabId },
            files: ["content.js"]
          },
          () => {
            if (chrome.runtime.lastError) {
              log("Content script injection failed:", chrome.runtime.lastError.message);
              return;
            }
            chrome.tabs.sendMessage(tabId, { type: "TRIGGER_AUTOFILL" }, () => {
              if (chrome.runtime.lastError) {
                log("Retry TRIGGER_AUTOFILL failed:", chrome.runtime.lastError.message);
              }
            });
          }
        );
      }
    }
  });
}

async function attachFilesToTab(tabId, fileAttachments) {
  const entries = Object.entries(fileAttachments || {})
    .filter(([selector, filePath]) => selector && filePath && typeof filePath === "string");

  if (entries.length === 0) {
    return { attached: 0, skipped: 0 };
  }

  const target = { tabId };
  let attached = 0;
  let skipped = 0;

  try {
    await debuggerAttach(target);
    await debuggerSendCommand(target, "DOM.enable");

    const doc = await debuggerSendCommand(target, "DOM.getDocument", { depth: -1, pierce: true });
    const rootNodeId = doc?.root?.nodeId;

    for (const [selector, filePath] of entries) {
      try {
        const query = await debuggerSendCommand(target, "DOM.querySelector", {
          nodeId: rootNodeId,
          selector
        });

        if (!query?.nodeId) {
          skipped += 1;
          continue;
        }

        await debuggerSendCommand(target, "DOM.setFileInputFiles", {
          nodeId: query.nodeId,
          files: [filePath]
        });

        attached += 1;
      } catch (error) {
        log("Failed setting file for selector", selector, error?.message);
        skipped += 1;
      }
    }
  } finally {
    await debuggerDetach(target).catch(() => {});
  }

  return { attached, skipped };
}

function debuggerAttach(target) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(target, "1.3", () => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve();
    });
  });
}

function debuggerDetach(target) {
  return new Promise((resolve, reject) => {
    chrome.debugger.detach(target, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve();
    });
  });
}

function debuggerSendCommand(target, method, commandParams = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, commandParams, (result) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(result);
    });
  });
}

const { generateStructuredJSON } = require("./openaiService");
const logger = require("../config/logger");

function normalize(input) {
  return (input || "").toString().toLowerCase();
}

function includesAny(haystack, words) {
  return words.some((word) => haystack.includes(word));
}

function buildDeterministicMapping(formFields, profile) {
  const mapping = {};

  for (const field of formFields) {
    const fieldText = normalize([
      field.label,
      field.placeholder,
      field.name,
      field.id,
      field.ariaLabel,
      field.type,
      field.tag,
      field.selector
    ].filter(Boolean).join(" "));

    const type = normalize(field.type);

    if (type === "file") {
      continue;
    }

    const scalarValue =
      includesAny(fieldText, ["preferred name", "nickname", "display name"]) ? (profile.preferredName || profile.firstName) :
      includesAny(fieldText, ["full name", "your name", "applicant name"]) ? profile.fullName :
      includesAny(fieldText, ["first name", "given name"]) ? profile.firstName :
      includesAny(fieldText, ["last name", "surname", "family name"]) ? profile.lastName :
      includesAny(fieldText, ["email", "e-mail"]) ? profile.email :
      includesAny(fieldText, ["phone", "mobile", "contact number"]) ? profile.phone :
      includesAny(fieldText, ["linkedin"]) ? profile.linkedin :
      includesAny(fieldText, ["github"]) ? profile.github :
      includesAny(fieldText, ["website", "portfolio"]) ? profile.website :
      includesAny(fieldText, ["address line 1", "street", "address1"]) ? profile.addressLine1 :
      includesAny(fieldText, ["address line 2", "address2", "apt", "suite"]) ? profile.addressLine2 :
      includesAny(fieldText, ["city", "town"]) ? profile.city :
      includesAny(fieldText, ["state", "province", "region"]) ? profile.state :
      includesAny(fieldText, ["country", "nation"]) ? profile.country :
      includesAny(fieldText, ["where do you currently live", "currently live", "where do you live", "reside", "residence", "current residence"]) ? buildResidenceAnswer(profile) :
      includesAny(fieldText, ["location"]) ? profile.location :
      includesAny(fieldText, ["title", "current role", "position"]) ? profile.currentTitle :
      includesAny(fieldText, ["company", "employer"]) ? profile.currentCompany :
      includesAny(fieldText, ["years", "experience"]) ? profile.yearsOfExperience :
      includesAny(fieldText, ["work authorization", "authorized to work", "visa", "sponsorship"]) ? profile.workAuthorization :
      includesAny(fieldText, ["skill"]) ? (Array.isArray(profile.skills) ? profile.skills.join(", ") : "") :
      includesAny(fieldText, ["where did you hear", "how did you hear", "how did you find", "source of application"])
        ? buildDiscoveryAnswer(profile)
        : includesAny(fieldText, ["summary", "about", "bio", "cover letter", "motivation", "why do you"])
          ? (profile.summary || createMotivationDefault(profile))
          : "";

    const value = mapChoiceIfNeeded(field, scalarValue, profile, fieldText);
    if (value) {
      mapping[field.selector] = value;
    }
  }

  return mapping;
}

function mapChoiceIfNeeded(field, scalarValue, profile, fieldText) {
  const options = Array.isArray(field.options) ? field.options : [];
  if (options.length === 0) {
    return scalarValue;
  }

  const normalizedScalar = normalize(scalarValue);
  const direct = findOptionByPredicate(options, (option) => {
    return normalize(option.value) === normalizedScalar || normalize(option.text) === normalizedScalar;
  });
  if (direct) {
    return direct.value || direct.text;
  }

  if (includesAny(fieldText, ["work authorization", "authorized"])) {
    const picked = findOptionByPredicate(options, (option) => {
      const t = normalize(`${option.text} ${option.value}`);
      return t.includes("india") || t.includes("indian") || t.includes("citizen") || t.includes("authorized");
    });
    if (picked) {
      return picked.value || picked.text;
    }
  }

  if (includesAny(fieldText, ["where did you hear", "how did you hear", "source"])) {
    const picked = findOptionByPredicate(options, (option) => {
      const t = normalize(`${option.text} ${option.value}`);
      return t.includes("linkedin") || t.includes("job board") || t.includes("website");
    });
    if (picked) {
      return picked.value || picked.text;
    }
  }

  if (includesAny(fieldText, ["country"])) {
    const picked = findOptionByPredicate(options, (option) => {
      const t = normalize(`${option.text} ${option.value}`);
      return t.includes(normalize(profile.country));
    });
    if (picked) {
      return picked.value || picked.text;
    }
  }

  if (includesAny(fieldText, ["state", "province"])) {
    const picked = findOptionByPredicate(options, (option) => {
      const t = normalize(`${option.text} ${option.value}`);
      return t.includes(normalize(profile.state));
    });
    if (picked) {
      return picked.value || picked.text;
    }
  }

  return scalarValue;
}

function findOptionByPredicate(options, predicate) {
  for (const option of options) {
    if (predicate(option)) {
      return option;
    }
  }
  return null;
}

function buildDiscoveryAnswer(profile) {
  return "LinkedIn";
}

function buildResidenceAnswer(profile) {
  const parts = [profile.city, profile.state, profile.country].filter(Boolean);
  if (parts.length > 0) {
    return parts.join(", ");
  }
  return profile.location || "";
}

function createMotivationDefault(profile) {
  const fullName = profile.fullName || "I";
  const title = profile.currentTitle || "software engineer";
  return `${fullName} is excited to apply for this opportunity. I bring strong experience as a ${title} and can contribute quickly with high-quality execution and collaboration.`;
}

function findUnmappedFields(formFields, mapping) {
  return formFields.filter((field) => !mapping[field.selector]);
}

async function aiRefineMapping({ formFields, profile, existingMapping }) {
  if (!formFields.length) {
    return {};
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      mapping: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: { type: "string" }
      }
    },
    required: ["mapping"]
  };

  const userPrompt = JSON.stringify(
    {
      profile,
      instructions: [
        "Return mapping object from selector to value.",
        "Only map selectors provided in fields.",
        "If authenticated profile is present, align all answers with profile data.",
        "For unknown values use __SKIP__.",
        "Do not return file paths in mapping; file attachments are handled separately.",
        "For select/radio/checkbox fields choose an option from provided options and return its exact value or visible text.",
        "For residence/location questions (e.g., 'Where do you currently live?'), answer with city/state/country from profile.",
        "For checkboxes with multi-select, return a comma-separated list of chosen options.",
        "For motivation/cover-letter/free-text answers keep it concise, professional, and consistent with profile experience.",
        "For 'Where did you hear about this job posting?' style questions, answer with a short source value only: 'LinkedIn' or 'Job Board'. Prefer 'LinkedIn' unless form options require otherwise."
      ],
      fields: formFields,
      alreadyMapped: existingMapping
    },
    null,
    2
  );

  const output = await generateStructuredJSON({
    schemaName: "autofill_field_mapping",
    jsonSchema: schema,
    systemPrompt:
      "You are an expert job-application autofill mapping engine. Reason over field semantics and candidate profile to produce precise, truthful, application-ready values.",
    userPrompt
  });

  return output.mapping || {};
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    })
  ]);
}

async function generateAutofillMapping({ formFields, profile }) {
  const deterministic = buildDeterministicMapping(formFields, profile);
  const unknownFields = findUnmappedFields(formFields, deterministic);

  if (unknownFields.length === 0) {
    return deterministic;
  }

  try {
    const aiTimeoutMs = Number(process.env.AI_MAPPING_TIMEOUT_MS || 9000) || 9000;
    const aiMapping = await withTimeout(
      aiRefineMapping({
        formFields: unknownFields,
        profile,
        existingMapping: deterministic
      }),
      aiTimeoutMs,
      `AI mapping timed out after ${aiTimeoutMs}ms`
    );

    return {
      ...deterministic,
      ...aiMapping
    };
  } catch (error) {
    logger.warn("AI mapping failed, using deterministic mapping only", { message: error.message });
    return deterministic;
  }
}

module.exports = {
  generateAutofillMapping
};

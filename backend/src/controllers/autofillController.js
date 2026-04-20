const Profile = require("../models/Profile");
const { generateAutofillMapping } = require("../services/autofillService");

function sanitizeFormFields(input) {
  if (!Array.isArray(input)) return [];

  return input
    .map((field) => ({
      selector: String(field.selector || ""),
      tag: String(field.tag || ""),
      type: String(field.type || ""),
      name: String(field.name || ""),
      id: String(field.id || ""),
      label: String(field.label || ""),
      placeholder: String(field.placeholder || ""),
      ariaLabel: String(field.ariaLabel || ""),
      required: Boolean(field.required),
      options: Array.isArray(field.options)
        ? field.options.map((opt) => ({
            value: String(opt.value || ""),
            text: String(opt.text || "")
          }))
        : []
    }))
    .filter((field) => field.selector);
}

function normalizeProfile(input = {}) {
  const address = input.address && typeof input.address === "object" ? input.address : {};

  return {
    fullName: input.fullName || "",
    preferredName: input.preferredName || "",
    firstName: input.firstName || "",
    lastName: input.lastName || "",
    email: input.email || "",
    phone: input.phone || "",
    location: input.location || "",
    currentTitle: input.currentTitle || "",
    currentCompany: input.currentCompany || "",
    linkedin: input.linkedin || "",
    github: input.github || "",
    website: input.website || "",
    skills: Array.isArray(input.skills) ? input.skills : [],
    yearsOfExperience: input.yearsOfExperience || "",
    summary: input.summary || "",
    workAuthorization: input.workAuthorization || "",
    addressLine1: input.addressLine1 || address.line1 || "",
    addressLine2: input.addressLine2 || address.line2 || "",
    city: input.city || address.city || "",
    state: input.state || address.state || "",
    country: input.country || address.country || "",
    resumeFilePath: input.resumeFilePath || ""
  };
}

async function resolveProfile(req) {
  if (req.user?._id) {
    const saved = await Profile.findOne({ userId: req.user._id });
    if (saved) {
      return normalizeProfile(saved.toObject());
    }
    // Single-user fallback mode: if token is present but linked profile is missing,
    // use the most recently updated profile in DB.
    const fallback = await Profile.findOne({}).sort({ updatedAt: -1, createdAt: -1 });
    if (fallback) {
      return normalizeProfile(fallback.toObject());
    }
    return null;
  }

  // Unauthenticated MVP mode only.
  if (req.body?.userProfile && Object.keys(req.body.userProfile).length > 0) {
    return normalizeProfile(req.body.userProfile);
  }

  // Single-user fallback mode (no auth): use most recently updated profile.
  const fallback = await Profile.findOne({}).sort({ updatedAt: -1, createdAt: -1 });
  if (fallback) {
    return normalizeProfile(fallback.toObject());
  }

  return null;
}

async function autofill(req, res) {
  const formFields = sanitizeFormFields(req.body?.formFields);
  if (formFields.length === 0) {
    return res.status(400).json({ success: false, message: "formFields must be a non-empty array" });
  }

  const profile = await resolveProfile(req);
  if (!profile) {
    return res.status(400).json({
      success: false,
      message: "No profile found in database. Create/update your profile first via /api/profile/me."
    });
  }

  const mapping = await generateAutofillMapping({ formFields, profile });
  const fileAttachments = buildFileAttachments({ formFields, profile });

  return res.status(200).json({
    success: true,
    mapping,
    fileAttachments
  });
}

function buildFileAttachments({ formFields, profile }) {
  const attachments = {};
  const resumePath = String(profile.resumeFilePath || "").trim();
  if (!resumePath) {
    return attachments;
  }

  for (const field of formFields) {
    const fieldType = (field.type || "").toLowerCase();
    if (fieldType !== "file") continue;

    const haystack = [field.label, field.placeholder, field.name, field.id, field.ariaLabel, field.selector]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const isResumeLike =
      haystack.includes("resume")
      || haystack.includes("cv")
      || haystack.includes("curriculum vitae")
      || haystack.includes("attachment");

    if (isResumeLike) {
      attachments[field.selector] = resumePath;
    }
  }

  return attachments;
}

module.exports = { autofill };

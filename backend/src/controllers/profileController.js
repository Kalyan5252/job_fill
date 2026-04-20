const fs = require("fs/promises");
const path = require("path");
const Profile = require("../models/Profile");
const { extractResumeText, parseResumeTextToProfile } = require("../services/resumeParserService");

function sanitizeProfileUpdate(input = {}) {
  const allowed = [
    "fullName",
    "preferredName",
    "firstName",
    "lastName",
    "email",
    "phone",
    "location",
    "currentTitle",
    "currentCompany",
    "linkedin",
    "github",
    "website",
    "skills",
    "yearsOfExperience",
    "summary",
    "workAuthorization",
    "address"
  ];

  const patch = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      patch[key] = input[key];
    }
  }

  if (Array.isArray(patch.skills)) {
    patch.skills = patch.skills.map((x) => String(x).trim()).filter(Boolean);
  }

  if (patch.address && typeof patch.address === "object") {
    patch.address = {
      line1: String(patch.address.line1 || ""),
      line2: String(patch.address.line2 || ""),
      city: String(patch.address.city || ""),
      state: String(patch.address.state || ""),
      country: String(patch.address.country || "")
    };
  }

  return patch;
}

async function getMe(req, res) {
  const profile = await Profile.findOne({ userId: req.user._id });
  return res.status(200).json({ success: true, profile });
}

async function updateMe(req, res) {
  const patch = sanitizeProfileUpdate(req.body || {});

  const profile = await Profile.findOneAndUpdate(
    { userId: req.user._id },
    { $set: patch },
    { new: true, upsert: true }
  );

  return res.status(200).json({ success: true, profile });
}

async function uploadResume(req, res) {
  if (!req.file) {
    return res.status(400).json({ success: false, message: "Resume file is required" });
  }

  const profile = await Profile.findOneAndUpdate(
    { userId: req.user._id },
    {
      $set: {
        resumeFilePath: req.file.path
      }
    },
    { new: true, upsert: true }
  );

  return res.status(200).json({
    success: true,
    message: "Resume uploaded successfully",
    profile,
    file: {
      originalName: req.file.originalname,
      path: req.file.path,
      size: req.file.size,
      mimetype: req.file.mimetype
    }
  });
}

async function parseResume(req, res) {
  const profile = await Profile.findOne({ userId: req.user._id });
  if (!profile?.resumeFilePath) {
    return res.status(400).json({ success: false, message: "No resume file found for current user" });
  }

  try {
    await fs.access(path.resolve(profile.resumeFilePath));
  } catch (_error) {
    return res.status(400).json({ success: false, message: "Stored resume file no longer exists" });
  }

  const resumeText = await extractResumeText(profile.resumeFilePath);
  const parsed = await parseResumeTextToProfile(resumeText);
  const patch = sanitizeProfileUpdate(parsed);

  const updated = await Profile.findOneAndUpdate(
    { userId: req.user._id },
    {
      $set: {
        ...patch,
        resumeText,
        resumeParsedJson: parsed
      }
    },
    { new: true }
  );

  return res.status(200).json({
    success: true,
    message: "Resume parsed successfully",
    parsed,
    profile: updated
  });
}

module.exports = {
  getMe,
  updateMe,
  uploadResume,
  parseResume
};

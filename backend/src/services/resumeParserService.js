const fs = require("fs/promises");
const path = require("path");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

const { generateStructuredJSON } = require("./openaiService");
const logger = require("../config/logger");

async function extractResumeText(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".pdf") {
    const buffer = await fs.readFile(filePath);
    const parsed = await pdfParse(buffer);
    return parsed.text || "";
  }

  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value || "";
  }

  const buffer = await fs.readFile(filePath);
  return buffer.toString("utf8");
}

async function parseResumeTextToProfile(resumeText) {
  const trimmed = (resumeText || "").slice(0, 25000);

  if (!trimmed) {
    return {};
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      fullName: { type: "string" },
      preferredName: { type: "string" },
      firstName: { type: "string" },
      lastName: { type: "string" },
      email: { type: "string" },
      phone: { type: "string" },
      location: { type: "string" },
      currentTitle: { type: "string" },
      currentCompany: { type: "string" },
      linkedin: { type: "string" },
      github: { type: "string" },
      website: { type: "string" },
      skills: {
        type: "array",
        items: { type: "string" }
      },
      yearsOfExperience: { type: "string" },
      summary: { type: "string" },
      address: {
        type: "object",
        additionalProperties: false,
        properties: {
          line1: { type: "string" },
          line2: { type: "string" },
          city: { type: "string" },
          state: { type: "string" },
          country: { type: "string" }
        },
        required: ["line1", "line2", "city", "state", "country"]
      }
    },
    required: [
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
      "address"
    ]
  };

  try {
    return await generateStructuredJSON({
      schemaName: "resume_profile_extract",
      jsonSchema: schema,
      systemPrompt:
        "You parse resumes into clean profile JSON for job-application autofill. Return accurate fields. Use empty strings for unknown scalars and [] for unknown skills. For address use empty strings for unknown fields.",
      userPrompt: `Extract profile JSON from resume text:\n\n${trimmed}`
    });
  } catch (error) {
    logger.warn("AI resume parsing failed, returning empty parse", { message: error.message });
    return {};
  }
}

module.exports = {
  extractResumeText,
  parseResumeTextToProfile
};

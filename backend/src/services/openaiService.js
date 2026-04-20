const OpenAI = require("openai");
const { env } = require("../config/env");
const logger = require("../config/logger");
const { withRetry } = require("../utils/retry");

let client = null;

function getClient() {
  if (!env.OPENAI_API_KEY) {
    return null;
  }

  if (!client) {
    client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }

  return client;
}

function getOutputText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  const outputs = response?.output || [];
  const chunks = [];

  for (const item of outputs) {
    const content = item?.content || [];
    for (const block of content) {
      if (block?.type === "output_text" && block.text) {
        chunks.push(block.text);
      }
    }
  }

  return chunks.join("\n").trim();
}

async function generateStructuredJSON({ systemPrompt, userPrompt, jsonSchema, schemaName }) {
  const apiClient = getClient();
  if (!apiClient) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const response = await withRetry(
    async () => apiClient.responses.create({
      model: env.OPENAI_MODEL,
      input: [
        { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
        { role: "user", content: [{ type: "input_text", text: userPrompt }] }
      ],
      text: {
        format: {
          type: "json_schema",
          name: schemaName,
          schema: jsonSchema,
          strict: true
        }
      }
    }),
    { retries: 3, baseDelayMs: 400 }
  );

  const raw = getOutputText(response);
  if (!raw) {
    logger.warn("OpenAI response missing output_text. Returning empty object.");
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    logger.error("Failed parsing OpenAI JSON output", { raw, message: error.message });
    throw new Error("AI output was not valid JSON");
  }
}

module.exports = { generateStructuredJSON };

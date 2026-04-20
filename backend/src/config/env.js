const path = require("path");

const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: Number(process.env.PORT || 4000),
  DB_FILE: process.env.DB_FILE || path.resolve(process.cwd(), "data", "job_autofill.sqlite"),
  JWT_SECRET: process.env.JWT_SECRET || "change_this_secret",
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "7d",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  OPENAI_MODEL: process.env.OPENAI_MODEL || "gpt-5-mini",
  UPLOAD_DIR: process.env.UPLOAD_DIR || "uploads",
  MAX_FILE_SIZE_BYTES: (Number(process.env.MAX_FILE_SIZE_MB || 10) || 10) * 1024 * 1024
};

env.UPLOAD_ABSOLUTE_PATH = path.resolve(process.cwd(), env.UPLOAD_DIR);

module.exports = { env };

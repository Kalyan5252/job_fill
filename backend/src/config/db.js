const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { env } = require("./env");
const logger = require("./logger");

let db;

function connectDatabase() {
  const dbPath = env.DB_FILE;
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL UNIQUE,
      full_name TEXT DEFAULT '',
      preferred_name TEXT DEFAULT '',
      first_name TEXT DEFAULT '',
      last_name TEXT DEFAULT '',
      email TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      location TEXT DEFAULT '',
      current_title TEXT DEFAULT '',
      current_company TEXT DEFAULT '',
      linkedin TEXT DEFAULT '',
      github TEXT DEFAULT '',
      website TEXT DEFAULT '',
      skills_json TEXT DEFAULT '[]',
      years_of_experience TEXT DEFAULT '',
      summary TEXT DEFAULT '',
      work_authorization TEXT DEFAULT '',
      address_json TEXT DEFAULT '{"line1":"","line2":"","city":"","state":"","country":""}',
      resume_file_path TEXT DEFAULT '',
      resume_text TEXT DEFAULT '',
      resume_parsed_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  logger.info(`SQLite connected at ${dbPath}`);
}

function getDb() {
  if (!db) {
    throw new Error("Database not initialized. Call connectDatabase() first.");
  }
  return db;
}

module.exports = connectDatabase;
module.exports.getDb = getDb;

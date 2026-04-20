const bcrypt = require("bcryptjs");
const { getDb } = require("../config/db");

function mapUser(row) {
  if (!row) return null;

  return {
    _id: String(row.id),
    email: row.email,
    passwordHash: row.password_hash,
    async comparePassword(password) {
      return bcrypt.compare(password, row.password_hash);
    }
  };
}

async function findOne(query = {}) {
  const db = getDb();

  if (query.email) {
    const row = db.prepare("SELECT * FROM users WHERE email = ?").get(String(query.email).toLowerCase());
    return mapUser(row);
  }

  return null;
}

async function findById(id) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(Number(id));
  return mapUser(row);
}

async function create({ email, passwordHash }) {
  const db = getDb();
  const now = new Date().toISOString();

  const result = db.prepare(
    "INSERT INTO users (email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)"
  ).run(String(email).toLowerCase(), passwordHash, now, now);

  return findById(result.lastInsertRowid);
}

async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

module.exports = {
  findOne,
  findById,
  create,
  hashPassword
};

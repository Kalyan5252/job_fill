const { getDb } = require("../config/db");

function parseJson(raw, fallback) {
  try {
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (_error) {
    return fallback;
  }
}

function toIsoNow() {
  return new Date().toISOString();
}

function mapProfile(row) {
  if (!row) return null;

  return {
    _id: String(row.id),
    userId: String(row.user_id),
    fullName: row.full_name || "",
    preferredName: row.preferred_name || "",
    firstName: row.first_name || "",
    lastName: row.last_name || "",
    email: row.email || "",
    phone: row.phone || "",
    location: row.location || "",
    currentTitle: row.current_title || "",
    currentCompany: row.current_company || "",
    linkedin: row.linkedin || "",
    github: row.github || "",
    website: row.website || "",
    skills: parseJson(row.skills_json, []),
    yearsOfExperience: row.years_of_experience || "",
    summary: row.summary || "",
    workAuthorization: row.work_authorization || "",
    address: parseJson(row.address_json, { line1: "", line2: "", city: "", state: "", country: "" }),
    resumeFilePath: row.resume_file_path || "",
    resumeText: row.resume_text || "",
    resumeParsedJson: parseJson(row.resume_parsed_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    toObject() {
      return {
        _id: String(row.id),
        userId: String(row.user_id),
        fullName: row.full_name || "",
        preferredName: row.preferred_name || "",
        firstName: row.first_name || "",
        lastName: row.last_name || "",
        email: row.email || "",
        phone: row.phone || "",
        location: row.location || "",
        currentTitle: row.current_title || "",
        currentCompany: row.current_company || "",
        linkedin: row.linkedin || "",
        github: row.github || "",
        website: row.website || "",
        skills: parseJson(row.skills_json, []),
        yearsOfExperience: row.years_of_experience || "",
        summary: row.summary || "",
        workAuthorization: row.work_authorization || "",
        address: parseJson(row.address_json, { line1: "", line2: "", city: "", state: "", country: "" }),
        resumeFilePath: row.resume_file_path || "",
        resumeText: row.resume_text || "",
        resumeParsedJson: parseJson(row.resume_parsed_json, {}),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    }
  };
}

function normalizePatch(patch = {}) {
  const address = patch.address && typeof patch.address === "object"
    ? patch.address
    : { line1: "", line2: "", city: "", state: "", country: "" };

  return {
    full_name: String(patch.fullName || ""),
    preferred_name: String(patch.preferredName || ""),
    first_name: String(patch.firstName || ""),
    last_name: String(patch.lastName || ""),
    email: String(patch.email || ""),
    phone: String(patch.phone || ""),
    location: String(patch.location || ""),
    current_title: String(patch.currentTitle || ""),
    current_company: String(patch.currentCompany || ""),
    linkedin: String(patch.linkedin || ""),
    github: String(patch.github || ""),
    website: String(patch.website || ""),
    skills_json: JSON.stringify(Array.isArray(patch.skills) ? patch.skills : []),
    years_of_experience: String(patch.yearsOfExperience || ""),
    summary: String(patch.summary || ""),
    work_authorization: String(patch.workAuthorization || ""),
    address_json: JSON.stringify({
      line1: String(address.line1 || ""),
      line2: String(address.line2 || ""),
      city: String(address.city || ""),
      state: String(address.state || ""),
      country: String(address.country || "")
    }),
    resume_file_path: String(patch.resumeFilePath || ""),
    resume_text: String(patch.resumeText || ""),
    resume_parsed_json: JSON.stringify(patch.resumeParsedJson && typeof patch.resumeParsedJson === "object" ? patch.resumeParsedJson : {})
  };
}

async function create(doc = {}) {
  const db = getDb();
  const now = toIsoNow();
  const normalized = normalizePatch(doc);

  const result = db.prepare(`
    INSERT INTO profiles (
      user_id, full_name, preferred_name, first_name, last_name, email, phone, location,
      current_title, current_company, linkedin, github, website, skills_json,
      years_of_experience, summary, work_authorization, address_json,
      resume_file_path, resume_text, resume_parsed_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(doc.userId || ""),
    normalized.full_name,
    normalized.preferred_name,
    normalized.first_name,
    normalized.last_name,
    normalized.email,
    normalized.phone,
    normalized.location,
    normalized.current_title,
    normalized.current_company,
    normalized.linkedin,
    normalized.github,
    normalized.website,
    normalized.skills_json,
    normalized.years_of_experience,
    normalized.summary,
    normalized.work_authorization,
    normalized.address_json,
    normalized.resume_file_path,
    normalized.resume_text,
    normalized.resume_parsed_json,
    now,
    now
  );

  return findById(result.lastInsertRowid);
}

async function findById(id) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM profiles WHERE id = ?").get(Number(id));
  return mapProfile(row);
}

async function findOne(query = {}) {
  const db = getDb();

  if (query.userId !== undefined) {
    const row = db.prepare("SELECT * FROM profiles WHERE user_id = ?").get(String(query.userId));
    return mapProfile(row);
  }

  const row = db.prepare("SELECT * FROM profiles ORDER BY updated_at DESC, created_at DESC LIMIT 1").get();
  return mapProfile(row);
}

async function findLatest() {
  return findOne({});
}

async function findOneAndUpdate(query = {}, update = {}, options = {}) {
  const existing = await findOne(query);
  const setPatch = update.$set && typeof update.$set === "object" ? update.$set : {};

  if (!existing && !options.upsert) {
    return null;
  }

  const userId = String(query.userId || existing?.userId || "");
  const merged = {
    ...(existing ? existing.toObject() : {}),
    ...setPatch,
    userId
  };

  const normalized = normalizePatch(merged);
  const now = toIsoNow();
  const db = getDb();

  if (existing) {
    db.prepare(`
      UPDATE profiles SET
        full_name = ?, preferred_name = ?, first_name = ?, last_name = ?, email = ?, phone = ?, location = ?,
        current_title = ?, current_company = ?, linkedin = ?, github = ?, website = ?, skills_json = ?,
        years_of_experience = ?, summary = ?, work_authorization = ?, address_json = ?,
        resume_file_path = ?, resume_text = ?, resume_parsed_json = ?, updated_at = ?
      WHERE user_id = ?
    `).run(
      normalized.full_name,
      normalized.preferred_name,
      normalized.first_name,
      normalized.last_name,
      normalized.email,
      normalized.phone,
      normalized.location,
      normalized.current_title,
      normalized.current_company,
      normalized.linkedin,
      normalized.github,
      normalized.website,
      normalized.skills_json,
      normalized.years_of_experience,
      normalized.summary,
      normalized.work_authorization,
      normalized.address_json,
      normalized.resume_file_path,
      normalized.resume_text,
      normalized.resume_parsed_json,
      now,
      userId
    );
  } else {
    const createdAt = now;
    db.prepare(`
      INSERT INTO profiles (
        user_id, full_name, preferred_name, first_name, last_name, email, phone, location,
        current_title, current_company, linkedin, github, website, skills_json,
        years_of_experience, summary, work_authorization, address_json,
        resume_file_path, resume_text, resume_parsed_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      normalized.full_name,
      normalized.preferred_name,
      normalized.first_name,
      normalized.last_name,
      normalized.email,
      normalized.phone,
      normalized.location,
      normalized.current_title,
      normalized.current_company,
      normalized.linkedin,
      normalized.github,
      normalized.website,
      normalized.skills_json,
      normalized.years_of_experience,
      normalized.summary,
      normalized.work_authorization,
      normalized.address_json,
      normalized.resume_file_path,
      normalized.resume_text,
      normalized.resume_parsed_json,
      createdAt,
      now
    );
  }

  return findOne({ userId });
}

module.exports = {
  create,
  findById,
  findOne,
  findLatest,
  findOneAndUpdate
};

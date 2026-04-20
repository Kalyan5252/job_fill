const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const { env } = require("../config/env");
const asyncHandler = require("../utils/asyncHandler");
const { requireAuth } = require("../middleware/auth");
const {
  getMe,
  updateMe,
  uploadResume,
  parseResume
} = require("../controllers/profileController");

const router = express.Router();

if (!fs.existsSync(env.UPLOAD_ABSOLUTE_PATH)) {
  fs.mkdirSync(env.UPLOAD_ABSOLUTE_PATH, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, env.UPLOAD_ABSOLUTE_PATH);
  },
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, "_");
    cb(null, `${Date.now()}_${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: env.MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([".pdf", ".doc", ".docx", ".txt"].includes(ext)) {
      cb(null, true);
      return;
    }
    cb(new Error("Unsupported resume format. Allowed: .pdf, .doc, .docx, .txt"));
  }
});

router.get("/me", requireAuth, asyncHandler(getMe));
router.put("/me", requireAuth, asyncHandler(updateMe));
router.post("/resume", requireAuth, upload.single("resume"), asyncHandler(uploadResume));
router.post("/resume/parse", requireAuth, asyncHandler(parseResume));

module.exports = router;

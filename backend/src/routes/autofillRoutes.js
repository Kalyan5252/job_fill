const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { optionalAuth } = require("../middleware/auth");
const { autofill } = require("../controllers/autofillController");

const router = express.Router();

router.post("/", optionalAuth, asyncHandler(autofill));

module.exports = router;

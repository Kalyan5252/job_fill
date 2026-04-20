const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Profile = require("../models/Profile");
const { env } = require("../config/env");

function signToken(userId) {
  return jwt.sign({ sub: userId.toString() }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN
  });
}

async function signup(req, res) {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ success: false, message: "Email and password are required" });
  }

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    return res.status(409).json({ success: false, message: "Email already registered" });
  }

  const passwordHash = await User.hashPassword(password);
  const user = await User.create({ email, passwordHash });

  await Profile.create({
    userId: user._id,
    email,
    fullName: ""
  });

  const token = signToken(user._id);

  return res.status(201).json({
    success: true,
    token,
    user: { id: user._id, email: user.email }
  });
}

async function login(req, res) {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ success: false, message: "Email and password are required" });
  }

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    return res.status(401).json({ success: false, message: "Invalid email or password" });
  }

  const valid = await user.comparePassword(password);
  if (!valid) {
    return res.status(401).json({ success: false, message: "Invalid email or password" });
  }

  const token = signToken(user._id);
  return res.status(200).json({
    success: true,
    token,
    user: { id: user._id, email: user.email }
  });
}

module.exports = { signup, login };

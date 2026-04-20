const jwt = require("jsonwebtoken");
const { env } = require("../config/env");
const User = require("../models/User");

async function decodeToken(token) {
  const payload = jwt.verify(token, env.JWT_SECRET);
  const user = await User.findById(payload.sub);
  if (!user) return null;
  return { _id: user._id, email: user.email };
}

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) {
      return res.status(401).json({ success: false, message: "Missing auth token" });
    }

    const user = await decodeToken(token);
    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid auth token" });
    }

    req.user = user;
    return next();
  } catch (_error) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
}

async function optionalAuth(req, _res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) {
      return next();
    }

    const user = await decodeToken(token);
    if (user) {
      req.user = user;
    }
    return next();
  } catch (_error) {
    return next();
  }
}

module.exports = { requireAuth, optionalAuth };

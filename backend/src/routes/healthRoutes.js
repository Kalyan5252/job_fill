const express = require("express");

const router = express.Router();

router.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    service: "job-autofill-agent-backend",
    timestamp: new Date().toISOString()
  });
});

module.exports = router;

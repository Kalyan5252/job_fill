const logger = require("../config/logger");

function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  logger.error(`${req.method} ${req.originalUrl} failed`, {
    message: err.message,
    stack: err.stack
  });

  res.status(status).json({
    success: false,
    message: err.message || "Internal server error"
  });
}

module.exports = errorHandler;

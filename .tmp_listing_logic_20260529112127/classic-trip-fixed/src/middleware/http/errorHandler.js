const { NODE_ENV } = require("../../config/app");

function errorHandler(err, _req, res, _next) {
  const statusCode = err.statusCode || err.status || 500;
  const message = statusCode >= 500 && NODE_ENV === "production"
    ? "Internal server error"
    : (err.message || "Server error");

  if (NODE_ENV !== "production") {
    console.error(err);
  }

  res.status(statusCode).json({
    ok: false,
    message,
    requestId: _req.id,
    ...(NODE_ENV !== "production" ? { stack: err.stack } : {})
  });
}

module.exports = errorHandler;

function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Server error";

  if (process.env.NODE_ENV !== "production") {
    console.error("❌ ERROR:", err);
  }

  res.status(statusCode).json({
    ok: false,
    message,
    ...(process.env.NODE_ENV !== "production" ? { stack: err.stack } : {})
  });
}

module.exports = { errorHandler };

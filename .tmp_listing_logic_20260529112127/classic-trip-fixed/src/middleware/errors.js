function notFound(req, res, next) {
  res.status(404).json({ ok: false, message: "Not Found", path: req.originalUrl });
}

function errorHandler(err, req, res, _next) {
  const status = err.statusCode || err.status || 500;
  const message = err.message || "Server error";
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.error(err);
  }
  res.status(status).json({ ok: false, message });
}

module.exports = { notFound, errorHandler };

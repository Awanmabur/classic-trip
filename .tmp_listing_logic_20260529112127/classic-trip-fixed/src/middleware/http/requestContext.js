const crypto = require("crypto");

function requestContext(req, res, next) {
  const incomingId = String(req.headers["x-request-id"] || "").trim();
  const requestId = incomingId || crypto.randomUUID();
  req.id = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
}

module.exports = requestContext;

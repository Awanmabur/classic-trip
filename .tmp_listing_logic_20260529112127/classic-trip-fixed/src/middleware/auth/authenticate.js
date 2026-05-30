const jwt = require("jsonwebtoken");
const { JWT_ACCESS_SECRET } = require("../../config/app");

function getToken(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  return token || null;
}

function auth(req, res, next) {
  const token = getToken(req);
  if (!token) return res.status(401).json({ ok: false, message: "Missing access token" });

  try {
    req.user = jwt.verify(token, JWT_ACCESS_SECRET);
    return next();
  } catch (_error) {
    return res.status(401).json({ ok: false, message: "Invalid/expired access token" });
  }
}

function optionalAuth(req, _res, next) {
  const token = getToken(req);
  if (!token) return next();

  try {
    req.user = jwt.verify(token, JWT_ACCESS_SECRET);
  } catch (_error) {
    // ignore invalid token for guest routes
  }

  return next();
}

module.exports = { auth, optionalAuth };

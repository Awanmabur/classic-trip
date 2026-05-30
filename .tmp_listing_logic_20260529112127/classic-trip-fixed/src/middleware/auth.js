const jwt = require("jsonwebtoken");
const { JWT_ACCESS_SECRET } = require("../config/env");

function getToken(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  return token || null;
}

function auth(req, res, next) {
  const token = getToken(req);
  if (!token) return res.status(401).json({ ok: false, message: "Missing access token" });

  try {
    const decoded = jwt.verify(token, JWT_ACCESS_SECRET);
    req.user = decoded; // { userId, role, email, sid }
    return next();
  } catch (e) {
    return res.status(401).json({ ok: false, message: "Invalid/expired access token" });
  }
}

// Optional auth: if token exists and is valid -> req.user; if missing -> continue as guest
function optionalAuth(req, _res, next) {
  const token = getToken(req);
  if (!token) return next();
  try {
    req.user = jwt.verify(token, JWT_ACCESS_SECRET);
  } catch (_e) {
    // ignore invalid token for guest routes
  }
  return next();
}

module.exports = { auth, optionalAuth };

const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const {
  JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET,
  JWT_ACCESS_EXPIRES,
  JWT_REFRESH_EXPIRES
} = require("../../config/app");

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

function signAccessToken(payload) {
  return jwt.sign(payload, JWT_ACCESS_SECRET, { expiresIn: JWT_ACCESS_EXPIRES });
}

function signRefreshToken(payload) {
  return jwt.sign(
    {
      ...payload,
      jti: payload?.jti || randomToken(12)
    },
    JWT_REFRESH_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRES }
  );
}

function verifyRefreshToken(token) {
  return jwt.verify(token, JWT_REFRESH_SECRET);
}

function sha256(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

module.exports = { randomToken, signAccessToken, signRefreshToken, verifyRefreshToken, sha256 };

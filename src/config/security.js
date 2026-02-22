const helmet = require("helmet");
const cors = require("cors");
const mongoSanitize = require("express-mongo-sanitize");
const hpp = require("hpp");
const rateLimit = require("express-rate-limit");

// CORS: allow your frontend domains (set properly in production)
function corsMiddleware() {
  return cors({
    origin: true,
    credentials: true
  });
}

function helmetMiddleware() {
  return helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
  });
}

function sanitizeMiddleware() {
  return mongoSanitize();
}

function hppMiddleware() {
  return hpp();
}

function limiterGeneral() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 800,
    standardHeaders: true,
    legacyHeaders: false
  });
}

function limiterAuth() {
  return rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false
  });
}

module.exports = {
  corsMiddleware,
  helmetMiddleware,
  sanitizeMiddleware,
  hppMiddleware,
  limiterGeneral,
  limiterAuth
};

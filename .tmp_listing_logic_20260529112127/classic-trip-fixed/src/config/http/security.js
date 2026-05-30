const helmet = require("helmet");
const cors = require("cors");
const hpp = require("hpp");
const rateLimit = require("express-rate-limit");
const { WEB_ORIGIN } = require("../app");

const allowedOrigins = String(WEB_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function corsMiddleware() {
  return cors({
    origin(origin, callback) {
      if (!origin || !allowedOrigins.length || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Origin not allowed by CORS"));
    },
    credentials: true
  });
}

function helmetMiddleware() {
  return helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
  });
}

function sanitizeValue(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.entries(value).reduce((acc, [key, entryValue]) => {
    const safeKey = String(key || "").replace(/\$/g, "").replace(/\./g, "");
    acc[safeKey] = sanitizeValue(entryValue);
    return acc;
  }, {});
}

function overwriteObject(target, source) {
  if (!target || typeof target !== "object") return;
  Object.keys(target).forEach((key) => delete target[key]);
  Object.assign(target, source);
}

function sanitizeMiddleware() {
  return (req, _res, next) => {
    if (req.body && typeof req.body === "object") {
      req.body = sanitizeValue(req.body);
    }

    if (req.params && typeof req.params === "object") {
      overwriteObject(req.params, sanitizeValue(req.params));
    }

    if (req.query && typeof req.query === "object") {
      overwriteObject(req.query, sanitizeValue(req.query));
    }

    next();
  };
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

function limiterPayment() {
  return rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false
  });
}

function limiterPublicForms() {
  return rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 30,
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
  limiterAuth,
  limiterPayment,
  limiterPublicForms
};

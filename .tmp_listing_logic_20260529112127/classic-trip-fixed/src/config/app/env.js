const dotenv = require("dotenv");
dotenv.config({ quiet: true });

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function stringEnv(name, fallback = "") {
  const value = process.env[name];
  return value == null || value === "" ? fallback : value;
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function booleanEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return String(raw).toLowerCase() === "true";
}

const NODE_ENV = stringEnv("NODE_ENV", "development").trim().toLowerCase();
const IS_PRODUCTION = NODE_ENV === "production";
const PORT = numberEnv("PORT", 3000);
const LOCAL_APP_URL = `http://localhost:${PORT}`;
const TENANT_DB_PREFIX = stringEnv("TENANT_DB_PREFIX", "classic_trip_tenant");
const PLATFORM_MONGO_URI = stringEnv("PLATFORM_MONGO_URI", "mongodb://127.0.0.1:27017/classic_trip_platform");
const TENANT_MONGO_BASE_URI = stringEnv("TENANT_MONGO_BASE_URI", "mongodb://127.0.0.1:27017");
const TENANT_LOCAL_DOMAIN_SUFFIX = stringEnv("TENANT_LOCAL_DOMAIN_SUFFIX", "localhost")
  .trim()
  .toLowerCase()
  .replace(/^\.+/, "")
  .replace(/\.+$/, "") || "localhost";
const JWT_ACCESS_SECRET = requireEnv("JWT_ACCESS_SECRET");
const JWT_REFRESH_SECRET = requireEnv("JWT_REFRESH_SECRET");
const PAYMENT_PROVIDER = stringEnv("PAYMENT_PROVIDER", "mock");
const PAYMENT_WEBHOOK_SECRET = stringEnv("PAYMENT_WEBHOOK_SECRET", "classic-trip-mock-webhook-secret");
const COOKIE_SECURE = booleanEnv("COOKIE_SECURE", IS_PRODUCTION);
const COOKIE_SAME_SITE = stringEnv("COOKIE_SAME_SITE", "lax").trim().toLowerCase();
const CLOUDINARY_CLOUD_NAME = stringEnv("CLOUDINARY_CLOUD_NAME", "");
const CLOUDINARY_API_KEY = stringEnv("CLOUDINARY_API_KEY", "");
const CLOUDINARY_API_SECRET = stringEnv("CLOUDINARY_API_SECRET", "");
const ADMIN_PASSWORD = stringEnv("ADMIN_PASSWORD", "AdminPass123!");

function assertRuntimeConfig() {
  const issues = [];

  if (!["lax", "strict", "none"].includes(COOKIE_SAME_SITE)) {
    issues.push("COOKIE_SAME_SITE must be one of: lax, strict, none");
  }

  if (COOKIE_SAME_SITE === "none" && !COOKIE_SECURE) {
    issues.push("COOKIE_SECURE must be true when COOKIE_SAME_SITE is 'none'");
  }

  if (!IS_PRODUCTION) {
    if (issues.length) {
      throw new Error(`Invalid runtime configuration:\n- ${issues.join("\n- ")}`);
    }
    return;
  }

  if (/change_me/i.test(JWT_ACCESS_SECRET) || JWT_ACCESS_SECRET.length < 24) {
    issues.push("JWT_ACCESS_SECRET must be replaced with a strong production secret");
  }

  if (/change_me/i.test(JWT_REFRESH_SECRET) || JWT_REFRESH_SECRET.length < 24) {
    issues.push("JWT_REFRESH_SECRET must be replaced with a strong production secret");
  }

  if (ADMIN_PASSWORD === "AdminPass123!") {
    issues.push("ADMIN_PASSWORD must be changed before starting in production");
  }

  if (PAYMENT_PROVIDER !== "mock" && /change_me/i.test(PAYMENT_WEBHOOK_SECRET)) {
    issues.push("PAYMENT_WEBHOOK_SECRET must be set for non-mock payment providers");
  }

  if (!COOKIE_SECURE) {
    issues.push("COOKIE_SECURE must be true in production");
  }

  if (issues.length) {
    throw new Error(`Invalid production configuration:\n- ${issues.join("\n- ")}`);
  }
}

assertRuntimeConfig();

module.exports = {
  NODE_ENV,
  IS_PRODUCTION,
  APP_NAME: stringEnv("APP_NAME", "Classic Trip"),
  PORT,
  APP_URL: stringEnv("APP_URL", LOCAL_APP_URL),
  API_BASE_URL: stringEnv("API_BASE_URL", LOCAL_APP_URL),
  WEB_ORIGIN: stringEnv("WEB_ORIGIN", LOCAL_APP_URL),
  TRUST_PROXY: booleanEnv("TRUST_PROXY", false),
  PLATFORM_MONGO_URI,
  TENANT_MONGO_BASE_URI,
  TENANT_DB_PREFIX,
  TENANT_LOCAL_DOMAIN_SUFFIX,

  JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET,
  JWT_ACCESS_EXPIRES: stringEnv("JWT_ACCESS_EXPIRES", "15m"),
  JWT_REFRESH_EXPIRES: stringEnv("JWT_REFRESH_EXPIRES", "14d"),

  COOKIE_SECURE,
  COOKIE_SAME_SITE,
  COOKIE_DOMAIN: stringEnv("COOKIE_DOMAIN", ""),
  REFRESH_COOKIE_NAME: stringEnv("REFRESH_COOKIE_NAME", "ct_rt"),

  SEAT_HOLD_MINUTES: numberEnv("SEAT_HOLD_MINUTES", 10),

  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
  CLOUDINARY_FOLDER: stringEnv("CLOUDINARY_FOLDER", "classic-trip"),
  CLOUDINARY_ENABLED: [CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET].every(Boolean),

  ADMIN_NAME: stringEnv("ADMIN_NAME", "Admin"),
  ADMIN_EMAIL: stringEnv("ADMIN_EMAIL", "admin@classictrip.test"),
  ADMIN_PASSWORD,

  PAYMENT_PROVIDER,
  PAYMENT_WEBHOOK_SECRET,

  // Google OAuth
  GOOGLE_CLIENT_ID: stringEnv("GOOGLE_CLIENT_ID", ""),
  GOOGLE_CLIENT_SECRET: stringEnv("GOOGLE_CLIENT_SECRET", ""),
  GOOGLE_CALLBACK_URL: stringEnv("GOOGLE_CALLBACK_URL", ""),

  PROMOTER_COMMISSION: numberEnv("PROMOTER_COMMISSION", 3),
  PLATFORM_WITH_PROMOTER_COMMISSION: numberEnv("PLATFORM_WITH_PROMOTER_COMMISSION", 7),
  PLATFORM_COMMISSION: numberEnv("PLATFORM_COMMISSION", 10),
  COMPANY_COMMISSION: numberEnv("COMPANY_COMMISSION", 90)
};

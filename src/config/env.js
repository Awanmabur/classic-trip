const dotenv = require("dotenv");
dotenv.config();

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const API_BASE_URL = process.env.API_BASE_URL || `http://localhost:${PORT}`;
const WEB_ORIGIN = process.env.WEB_ORIGIN || `http://localhost:${PORT}`;

module.exports = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: Number(process.env.PORT || 3010),
  MONGO_URI: must("MONGO_URI"),

  JWT_ACCESS_SECRET: must("JWT_ACCESS_SECRET"),
  JWT_REFRESH_SECRET: must("JWT_REFRESH_SECRET"),
  JWT_ACCESS_EXPIRES: process.env.JWT_ACCESS_EXPIRES || "15m",
  JWT_REFRESH_EXPIRES: process.env.JWT_REFRESH_EXPIRES || "14d",

  COOKIE_SECURE: String(process.env.COOKIE_SECURE || "false") === "true",
  COOKIE_DOMAIN: process.env.COOKIE_DOMAIN || "",
  REFRESH_COOKIE_NAME: process.env.REFRESH_COOKIE_NAME || "ct_rt",

  SEAT_HOLD_MINUTES: Number(process.env.SEAT_HOLD_MINUTES || 10),

  CLOUDINARY_CLOUD_NAME: must("CLOUDINARY_CLOUD_NAME"),
  CLOUDINARY_API_KEY: must("CLOUDINARY_API_KEY"),
  CLOUDINARY_API_SECRET: must("CLOUDINARY_API_SECRET"),

  ADMIN_NAME: process.env.ADMIN_NAME || "Admin",
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || "admin@classictrip.test",
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "AdminPass123!"
};

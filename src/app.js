const dotenv = require("dotenv");
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const morgan = require("morgan");
const cors = require("cors");

const { NODE_ENV, WEB_ORIGIN, API_BASE_URL } = require("./config/env");
const { connectDB } = require("./config/db");
const apiRoutes = require("./routes");
const pageRoutes = require("./routes/pages");
const { notFound, errorHandler } = require("./middleware/errors");

const app = express();

// Trust proxy for production behind nginx
app.set("trust proxy", 1);

// Views
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));

app.use(helmet({ contentSecurityPolicy: false })); // CSP can be tightened later
app.use(compression());
app.use(morgan(NODE_ENV === "production" ? "combined" : "dev"));

app.use(cors({
  origin: WEB_ORIGIN || true,
  credentials: true
}));

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Static
app.use("/public", express.static(path.join(__dirname, "..", "public"), { maxAge: NODE_ENV === "production" ? "7d" : 0 }));

// Template globals
app.use((req, res, next) => {
  res.locals.APP_NAME = process.env.APP_NAME || "Classic Trip";
  res.locals.API_BASE = API_BASE_URL || "http://localhost:3000"; // same server in single app
  next();
});

// Pages first
app.use("/", pageRoutes);

// API
app.use("/api", apiRoutes);

// Errors
app.use(notFound);
app.use(errorHandler);

// Boot
async function boot() {
  await connectDB();
  return app;
}

module.exports = { app, boot };

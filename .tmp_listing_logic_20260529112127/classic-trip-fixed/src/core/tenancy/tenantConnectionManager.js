const mongoose = require("mongoose");
const {
  NODE_ENV,
  TENANT_DB_PREFIX,
  TENANT_MONGO_BASE_URI
} = require("../../config/app");
const { registerTenantModels } = require("../../models/tenant/register");

const connections = new Map();

function sanitizeTenantKey(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildTenantDbName(slug = "") {
  const clean = sanitizeTenantKey(slug);
  if (!clean) return `${TENANT_DB_PREFIX}_${Date.now()}`;
  return `${TENANT_DB_PREFIX}_${clean}`;
}

function buildTenantUri(databaseName) {
  const base = String(TENANT_MONGO_BASE_URI || "mongodb://127.0.0.1:27017").replace(/\/+$/, "");
  return `${base}/${encodeURIComponent(databaseName)}`;
}

function ensureRegistered(connection) {
  registerTenantModels(connection);
  return connection;
}

function createTenantConnection(databaseName) {
  return ensureRegistered(mongoose.createConnection(buildTenantUri(databaseName), {
    autoIndex: NODE_ENV !== "production",
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10000
  }));
}

async function getTenantConnection(tenant) {
  if (!tenant?.databaseName) {
    throw new Error("Tenant databaseName is required");
  }

  const key = String(tenant.databaseName);
  const existing = connections.get(key);
  if (existing?.readyState === 1) return existing;
  if (existing?.readyState === 2) {
    await existing.asPromise();
    return existing;
  }

  const connection = createTenantConnection(key);
  connections.set(key, connection);
  await connection.asPromise();
  console.log(`Tenant MongoDB connected (${key})`);
  return connection;
}

async function closeTenantConnections() {
  const pending = [];
  connections.forEach((connection) => {
    if (connection.readyState !== 0) pending.push(connection.close());
  });
  await Promise.all(pending);
  connections.clear();
}

function getTenantConnectionStats() {
  let connected = 0;
  let connecting = 0;
  let disconnecting = 0;
  let disconnected = 0;

  connections.forEach((connection) => {
    if (connection.readyState === 1) connected += 1;
    else if (connection.readyState === 2) connecting += 1;
    else if (connection.readyState === 3) disconnecting += 1;
    else disconnected += 1;
  });

  return {
    total: connections.size,
    connected,
    connecting,
    disconnecting,
    disconnected
  };
}

module.exports = {
  buildTenantDbName,
  buildTenantUri,
  closeTenantConnections,
  getTenantConnection,
  getTenantConnectionStats
};

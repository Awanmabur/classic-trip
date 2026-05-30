const os = require("os");
const { APP_NAME, NODE_ENV } = require("../../config/app");
const { getStartedAt, isShuttingDown } = require("../../config/app/runtime");
const { platformConnection } = require("../../config/database");
const { getTenantConnectionStats } = require("../../core/tenancy");

function platformDbState() {
  switch (platformConnection.readyState) {
    case 1:
      return "connected";
    case 2:
      return "connecting";
    case 3:
      return "disconnecting";
    default:
      return "disconnected";
  }
}

function basePayload() {
  return {
    ok: true,
    app: APP_NAME,
    env: NODE_ENV,
    hostname: os.hostname(),
    timestamp: new Date().toISOString(),
    startedAt: getStartedAt().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    shuttingDown: isShuttingDown(),
    services: {
      platformDb: platformDbState(),
      tenantConnections: getTenantConnectionStats()
    }
  };
}

exports.health = (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(basePayload());
};

exports.ready = async (_req, res) => {
  res.set("Cache-Control", "no-store");

  if (isShuttingDown()) {
    return res.status(503).json({
      ...basePayload(),
      ok: false,
      message: "Server is shutting down"
    });
  }

  if (platformConnection.readyState !== 1 || !platformConnection.db) {
    return res.status(503).json({
      ...basePayload(),
      ok: false,
      message: "Platform database is not ready"
    });
  }

  try {
    await platformConnection.db.admin().ping();
    return res.json(basePayload());
  } catch (err) {
    return res.status(503).json({
      ...basePayload(),
      ok: false,
      message: "Database ping failed"
    });
  }
};

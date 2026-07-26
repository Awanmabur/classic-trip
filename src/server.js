const app = require('./app');
const { env, validateEnv } = require('./config/env');
const { connectDb, mongoose } = require('./config/db');
const logger = require('./config/logger');
const { ensurePlatformConfig } = require('./services/platform/platformConfigService');
const { startScheduledJobs } = require('./jobs/scheduler');
const repositories = require('./repositories');
const dashboardSnapshotService = require('./services/dashboard/dashboardSnapshotService');

let httpServer = null;
let shuttingDown = false;

async function start() {
  validateEnv();
  await connectDb();
  repositories.readyRepository('companies');
  await ensurePlatformConfig();
  startScheduledJobs();
  // Begin the expensive platform snapshot once at startup. Dashboard requests
  // share the same in-flight promise and then use a short-lived cache.
  dashboardSnapshotService.prewarm('admin').catch((error) => {
    logger.warn('Dashboard snapshot prewarm failed', { error: error.message });
  });
  httpServer = app.listen(env.port, () => {
    logger.info(`${env.appName} server listening`, { url: `${env.appUrl}`, port: env.port, nodeEnv: env.nodeEnv });
  });
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout = 66_000;
  return httpServer;
}

async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Graceful shutdown started', { signal });
  const forceTimer = setTimeout(() => {
    logger.error('Graceful shutdown timed out', { signal });
    process.exit(1);
  }, 12_000);
  forceTimer.unref();
  try {
    if (httpServer) {
      await new Promise((resolve, reject) => httpServer.close((error) => (error ? reject(error) : resolve())));
    }
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    clearTimeout(forceTimer);
    logger.info('Graceful shutdown complete', { signal });
    process.exit(exitCode);
  } catch (error) {
    clearTimeout(forceTimer);
    logger.error('Graceful shutdown failed', { signal, error: error.message, stack: error.stack });
    process.exit(1);
  }
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (error) => {
  logger.error('Unhandled promise rejection', { error: error?.message || String(error), stack: error?.stack });
  shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  shutdown('uncaughtException', 1);
});

start().catch((error) => {
  logger.error('Startup failed', { error: error.message, stack: error.stack });
  process.exit(1);
});

module.exports = { start, shutdown };

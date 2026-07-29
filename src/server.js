const app = require('./app');
const { env, validateEnv } = require('./config/env');
const { connectDb, mongoose } = require('./config/db');
const logger = require('./config/logger');
const { ensurePlatformConfig } = require('./services/platform/platformConfigService');
const { startScheduledJobs } = require('./jobs/scheduler');
const repositories = require('./repositories');
const catalogService = require('./services/marketplace/catalogService');
const { restoreLegacyDemotedBusListings } = require('./services/migrations/legacyBusListingPublicationRepair');

let httpServer = null;
let shuttingDown = false;

async function start() {
  validateEnv();
  await connectDb();
  repositories.readyRepository('companies');
  await ensurePlatformConfig();
  startScheduledJobs();
  if (env.nodeEnvWasNormalized) {
    logger.warn('NODE_ENV spelling was corrected', { from: env.rawNodeEnv, to: env.nodeEnv });
  }
  httpServer = app.listen(env.port, () => {
    logger.startup(`${env.appName} listening`, { url: `${env.appUrl}`, port: env.port, nodeEnv: env.nodeEnv });
  });
  // Warm only the public catalog after the port is available. A complete
  // super-admin snapshot can contain hundreds of collections and must never
  // compete with login/session traffic during startup.
  Promise.allSettled([
    restoreLegacyDemotedBusListings().then((restored) => {
      if (restored) logger.info('Restored legacy-demoted bus listings', { restored });
      return catalogService.prewarmHome();
    }),
  ]).then((results) => {
    const failed = results.filter((result) => result.status === 'rejected');
    if (failed.length) logger.warn('One or more read-model prewarms failed', { count: failed.length });
  });
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout = 66_000;
  httpServer.requestTimeout = 30_000;
  httpServer.maxRequestsPerSocket = 1_000;
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

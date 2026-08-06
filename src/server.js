const { env, validateEnv } = require('./config/env');
const { connectDb, mongoose } = require('./config/db');
const { connectRedis, closeRedis } = require('./config/redis');
const logger = require('./config/logger');
const { ensurePlatformConfig } = require('./services/platform/platformConfigService');
const repositories = require('./repositories');
const scheduleMaterializer = require('./jobs/materializeSchedules');

let httpServer = null;
let shuttingDown = false;
let app = null;

async function start() {
  validateEnv();
  await Promise.all([connectDb(), connectRedis()]);
  repositories.readyRepository('companies');
  await ensurePlatformConfig();
  // Session and rate-limit middleware choose their backing stores while app.js
  // is loaded, so Redis must be connected before the application is required.
  app = require('./app');
  if (env.nodeEnvWasNormalized) {
    logger.warn('NODE_ENV spelling was corrected', { from: env.rawNodeEnv, to: env.nodeEnv });
  }
  httpServer = app.listen(env.port, () => {
    logger.startup(`${env.appName} listening`, { url: `${env.appUrl}`, port: env.port, nodeEnv: env.nodeEnv });
  });
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout = 66_000;
  httpServer.requestTimeout = 45_000;
  httpServer.maxRequestsPerSocket = 1_000;
  // A standalone web process may explicitly opt into the lease-protected repair
  // queue. Normal and separate-worker production launchers keep it disabled so
  // two processes do not scan the same rules or invalidate dashboard caches.
  const fallbackDefault = env.nodeEnv === 'production' ? 'false' : 'true';
  const webRollingFallback = String(process.env.WEB_ROLLING_FALLBACK || fallbackDefault).trim().toLowerCase() === 'true';
  if (webRollingFallback) scheduleMaterializer.startWebFallback();
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
    scheduleMaterializer.stopWebFallback();
    if (httpServer) {
      await new Promise((resolve, reject) => httpServer.close((error) => (error ? reject(error) : resolve())));
    }
    await closeRedis();
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

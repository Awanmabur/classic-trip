'use strict';

const { env } = require('./config/env');
const { connectDb, mongoose } = require('./config/db');
const { connectRedis, closeRedis } = require('./config/redis');
const logger = require('./config/logger');
const { ensurePlatformConfig } = require('./services/platform/platformConfigService');
const { startScheduledJobs, stopScheduledJobs } = require('./jobs/scheduler');
const { restoreLegacyDemotedBusListings } = require('./services/migrations/legacyBusListingPublicationRepair');
const scheduleMaterializer = require('./jobs/materializeSchedules');

let stopping = false;

async function start() {
  if (!env.mongoUri) throw new Error('MONGO_URI is required for the background worker');
  await Promise.all([connectDb(), connectRedis()]);
  await ensurePlatformConfig();
  // Establish the single low-priority rolling queue owner before cron tasks are
  // registered, so materializeSchedules is queue-first even during startup.
  scheduleMaterializer.startWebFallback({ startupDelayMs: 10000 });
  const jobs = startScheduledJobs({ force: true });
  logger.startup('Classic Trip background worker started', { jobs: jobs.jobs });
  // Reconcile legacy "active" departures and fill the rolling month as soon
  // as a release starts; do not leave public listings on "Coming soon" until
  // the next 03:00 materialization cron.
  // The worker is the single rolling-queue owner under `npm start`. It drains
  // all remaining dates in bounded batches and keeps the five-minute repair
  // scan, while the web process stays free to serve fares, checkout and dashboards.
  setImmediate(async () => {
    try {
      const restored = await restoreLegacyDemotedBusListings();
      if (restored) logger.info('Restored legacy-demoted bus listings', { restored });
    } catch (error) {
      logger.warn('Legacy bus listing repair will retry on the next worker start', { error: error.message });
    }
  });
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  logger.info('Background worker shutdown started', { signal });
  stopScheduledJobs();
  scheduleMaterializer.stopWebFallback();
  await closeRedis();
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  process.exit(0);
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

start().catch((error) => {
  logger.error('Background worker startup failed', { error: error.message, stack: error.stack });
  process.exit(1);
});

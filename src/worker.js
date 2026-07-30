'use strict';

const { env } = require('./config/env');
const { connectDb, mongoose } = require('./config/db');
const { connectRedis, closeRedis } = require('./config/redis');
const logger = require('./config/logger');
const { ensurePlatformConfig } = require('./services/platform/platformConfigService');
const { startScheduledJobs, stopScheduledJobs, runJob } = require('./jobs/scheduler');
const { restoreLegacyDemotedBusListings } = require('./services/migrations/legacyBusListingPublicationRepair');

let stopping = false;

async function start() {
  if (!env.mongoUri) throw new Error('MONGO_URI is required for the background worker');
  await Promise.all([connectDb(), connectRedis()]);
  await ensurePlatformConfig();
  const jobs = startScheduledJobs({ force: true });
  logger.startup('Classic Trip background worker started', { jobs: jobs.jobs });
  // Reconcile legacy "active" departures and fill the rolling month as soon
  // as a release starts; do not leave public listings on "Coming soon" until
  // the next 03:00 materialization cron.
  setImmediate(async () => {
    try {
      const restored = await restoreLegacyDemotedBusListings();
      if (restored) logger.info('Restored legacy-demoted bus listings', { restored });
    } catch (error) {
      logger.warn('Legacy bus listing repair will retry on the next worker start', { error: error.message });
    }
    await runJob('materializeSchedules');
  });
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  logger.info('Background worker shutdown started', { signal });
  stopScheduledJobs();
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

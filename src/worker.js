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
  // Rolling departures use the normal scheduler plus lifecycle outbox events.
  // Do not run a second private queue/timer alongside node-cron.
  const jobs = startScheduledJobs({ force: true });
  logger.startup('Classic Trip background worker started', { jobs: jobs.jobs });
  // Normalize legacy duplicate/overlapping rolling rules once at worker startup.
  // This is intentionally metadata-only: it does not build a 30-day window here,
  // so startup stays fast while old rule-10/rule-11 style conflicts stop spamming
  // the scheduler before the normal 15-minute recovery pass.
  setImmediate(async () => {
    try {
      const normalized = await scheduleMaterializer.normalizeActiveRules(new Date());
      if (normalized.paused > 0) logger.info('Normalized legacy recurring departure rules', { paused: normalized.paused, active: normalized.activeAfter });
    } catch (error) {
      logger.warn('Recurring departure rule normalization will retry on the scheduled repair pass', { error: error.message });
    }
  });
  // Existing rolling rules are repaired by the scheduled materializer. New rules
  // are filled immediately in the company request, and lifecycle events request
  // replacement through the outbox.
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

const cron = require('node-cron');
const { env } = require('../config/env');
const logger = require('../config/logger');
const jobLeaseService = require('../services/shared/jobLeaseService');
const { mongoose } = require('../config/db');

const jobs = {
  processOutbox: {
    schedule: () => env.jobs.processOutbox,
    module: () => require('./processOutbox'),
    leaseTtlMs: 2 * 60 * 1000,
  },
  cleanupExpiredLocks: {
    schedule: () => env.jobs.cleanupExpiredLocks,
    module: () => require('./cleanupExpiredLocks'),
    leaseTtlMs: 15 * 60 * 1000,
  },
  releaseCommission: {
    schedule: () => env.jobs.releaseCommission,
    module: () => require('./releaseCommission'),
    leaseTtlMs: 30 * 60 * 1000,
  },
  expirePaymentIntents: {
    schedule: () => env.jobs.expirePaymentIntents,
    module: () => require('./expirePaymentIntents'),
    leaseTtlMs: 15 * 60 * 1000,
  },
  bookingReminders: {
    schedule: () => env.jobs.bookingReminders,
    module: () => require('./bookingReminders'),
    leaseTtlMs: 15 * 60 * 1000,
  },
  expirePromotions: {
    schedule: () => env.jobs.expirePromotions,
    module: () => require('./expirePromotions'),
    leaseTtlMs: 15 * 60 * 1000,
  },
  payoutReports: {
    schedule: () => env.jobs.payoutReports,
    module: () => require('./payoutReports'),
    leaseTtlMs: 60 * 60 * 1000,
  },
  materializeSchedules: {
    schedule: () => env.jobs.materializeSchedules,
    module: () => require('./materializeSchedules'),
    leaseTtlMs: 2 * 60 * 60 * 1000,
  },
  dispatchTaxiRides: {
    schedule: () => env.jobs.dispatchTaxiRides,
    module: () => require('./dispatchTaxiRides'),
    leaseTtlMs: 3 * 60 * 1000,
  },
  expireFlightHolds: {
    schedule: () => env.jobs.expireFlightHolds,
    module: () => require('./expireFlightHolds'),
    leaseTtlMs: 10 * 60 * 1000,
  },
  purgeArchivedRecords: {
    schedule: () => env.jobs.purgeArchivedRecords,
    module: () => require('./purgeArchivedRecords'),
    leaseTtlMs: 2 * 60 * 60 * 1000,
  },
};

const scheduledTasks = new Map();
const lastRuns = new Map();
const runningJobs = new Map();

function jobTimeoutMs(definition = {}) {
  return Math.max(5000, Math.min(Number(env.jobs.maxRunMs || 45000), Math.max(5000, Number(definition.leaseTtlMs || 60000) - 1000)));
}

function withTimeout(promise, milliseconds, name) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${name} exceeded the ${milliseconds}ms job deadline`);
      error.code = 'job_timeout';
      reject(error);
    }, milliseconds);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runJob(name) {
  const definition = jobs[name];
  if (!definition) {
    const error = new Error(`Unknown job: ${name}`);
    error.status = 404;
    throw error;
  }
  if (runningJobs.has(name)) {
    return {
      name,
      ok: true,
      skipped: true,
      reason: 'previous_run_still_active',
      startedAt: runningJobs.get(name).toISOString(),
    };
  }

  if (mongoose.connection.readyState !== 1) {
    const skipped = { name, ok: true, skipped: true, reason: 'mongodb_unavailable' };
    lastRuns.set(name, skipped);
    return skipped;
  }

  const startedAt = new Date();
  runningJobs.set(name, startedAt);
  let lease = null;
  let stopLeaseHeartbeat = () => {};
  try {
    lease = await jobLeaseService.acquire(name, definition.leaseTtlMs);
    if (!lease.acquired) {
      return {
        name,
        ok: true,
        skipped: true,
        reason: 'distributed_lease_held',
        leaseBackend: lease.backend,
      };
    }
    stopLeaseHeartbeat = jobLeaseService.keepAlive(lease, definition.leaseTtlMs);
    const result = await withTimeout(Promise.resolve().then(() => definition.module().run()), jobTimeoutMs(definition), name);
    const finishedAt = new Date();
    const status = {
      name,
      ok: true,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      result,
      leaseBackend: lease.backend,
    };
    lastRuns.set(name, status);
    logger.debug('Scheduled job completed', status);
    return status;
  } catch (error) {
    const failedAt = new Date();
    const status = {
      name,
      ok: false,
      startedAt: startedAt.toISOString(),
      finishedAt: failedAt.toISOString(),
      durationMs: failedAt.getTime() - startedAt.getTime(),
      error: error.message,
    };
    lastRuns.set(name, status);
    logger.error('Scheduled job failed', status);
    return status;
  } finally {
    stopLeaseHeartbeat();
    if (lease?.acquired) await lease.release().catch(() => {});
    runningJobs.delete(name);
  }
}

function startScheduledJobs({ force = false, active = true } = {}) {
  if (!force && !env.jobs.enabled) {
    if (env.isProduction) logger.warn('Scheduled jobs are disabled in production', { enableWith: 'ENABLE_JOBS=true' });
    return { started: false, jobs: [] };
  }
  if (scheduledTasks.size) return { started: true, jobs: Array.from(scheduledTasks.keys()) };

  Object.entries(jobs).forEach(([name, definition]) => {
    const expression = definition.schedule();
    if (!cron.validate(expression)) {
      logger.warn('Scheduled job skipped because cron expression is invalid', { name, expression });
      return;
    }
    const task = active
      ? cron.schedule(expression, () => runJob(name))
      : cron.createTask(expression, () => runJob(name));
    scheduledTasks.set(name, { expression, task, active });
    logger.debug('Scheduled job registered', { name, expression, active });
  });

  return { started: scheduledTasks.size > 0, jobs: Array.from(scheduledTasks.keys()) };
}

function stopScheduledJobs() {
  scheduledTasks.forEach(({ task }) => {
    task.stop();
    if (typeof task.destroy === 'function') task.destroy();
  });
  scheduledTasks.clear();
}

function jobStatus() {
  return Object.keys(jobs).map((name) => ({
    name,
    scheduled: scheduledTasks.has(name),
    active: scheduledTasks.get(name)?.active || false,
    expression: scheduledTasks.get(name)?.expression || jobs[name].schedule(),
    lastRun: lastRuns.get(name) || null,
  }));
}

module.exports = { startScheduledJobs, stopScheduledJobs, runJob, jobStatus };

const cron = require('node-cron');
const { env } = require('../config/env');
const logger = require('../config/logger');

const jobs = {
  cleanupExpiredLocks: {
    schedule: () => env.jobs.cleanupExpiredLocks,
    module: () => require('./cleanupExpiredLocks'),
  },
  releaseCommission: {
    schedule: () => env.jobs.releaseCommission,
    module: () => require('./releaseCommission'),
  },
  expirePaymentIntents: {
    schedule: () => env.jobs.expirePaymentIntents,
    module: () => require('./expirePaymentIntents'),
  },
  bookingReminders: {
    schedule: () => env.jobs.bookingReminders,
    module: () => require('./bookingReminders'),
  },
  expirePromotions: {
    schedule: () => env.jobs.expirePromotions,
    module: () => require('./expirePromotions'),
  },
  payoutReports: {
    schedule: () => env.jobs.payoutReports,
    module: () => require('./payoutReports'),
  },
  materializeSchedules: {
    schedule: () => env.jobs.materializeSchedules,
    module: () => require('./materializeSchedules'),
  },
};

const scheduledTasks = new Map();
const lastRuns = new Map();

async function runJob(name) {
  const definition = jobs[name];
  if (!definition) {
    const error = new Error(`Unknown job: ${name}`);
    error.status = 404;
    throw error;
  }

  const startedAt = new Date();
  try {
    const result = await definition.module().run();
    const finishedAt = new Date();
    const status = {
      name,
      ok: true,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      result,
    };
    lastRuns.set(name, status);
    logger.info('Scheduled job completed', status);
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
  }
}

function startScheduledJobs({ force = false, active = true } = {}) {
  if (!force && !env.jobs.enabled) {
    logger.info('Scheduled jobs disabled', { enableWith: 'ENABLE_JOBS=true' });
    return { started: false, jobs: [] };
  }
  if (scheduledTasks.size) return { started: true, jobs: Array.from(scheduledTasks.keys()) };

  Object.entries(jobs).forEach(([name, definition]) => {
    const expression = definition.schedule();
    if (!cron.validate(expression)) {
      logger.warn('Scheduled job skipped because cron expression is invalid', { name, expression });
      return;
    }
    const task = cron.schedule(expression, () => runJob(name), { scheduled: active });
    if (!active) task.stop();
    scheduledTasks.set(name, { expression, task, active });
    logger.info('Scheduled job registered', { name, expression, active });
  });

  return { started: scheduledTasks.size > 0, jobs: Array.from(scheduledTasks.keys()) };
}

function stopScheduledJobs() {
  scheduledTasks.forEach(({ task }) => task.stop());
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

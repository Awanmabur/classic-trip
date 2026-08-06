const outboxService = require('../services/shared/outboxService');
const { handlers } = require('../services/shared/outboxHandlers');
const { env } = require('../config/env');

async function run() {
  // Keep each pass small. A DNS/topology interruption must not hold the worker
  // for minutes or compete with login, preview, checkout, and dashboard reads.
  return outboxService.processBatch(handlers, { limit: env.jobs.outboxBatchSize });
}

module.exports = { run };

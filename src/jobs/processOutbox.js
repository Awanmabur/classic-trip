const outboxService = require('../services/shared/outboxService');
const { handlers } = require('../services/shared/outboxHandlers');

async function run() {
  // A short, frequent batch prevents the worker from monopolising the shared
  // MongoDB pool while still draining up to 150 events per minute.
  return outboxService.processBatch(handlers, { limit: 25 });
}

module.exports = { run };

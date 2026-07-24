const outboxService = require('../services/shared/outboxService');
const { handlers } = require('../services/shared/outboxHandlers');

async function run() {
  return outboxService.processBatch(handlers, { limit: 100 });
}

module.exports = { run };

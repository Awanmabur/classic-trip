const app = require('./app');
const { env, validateEnv } = require('./config/env');
const { connectDb, mongoose } = require('./config/db');
const logger = require('./config/logger');
const { ensurePlatformConfig } = require('./services/platform/platformConfigService');
const { startScheduledJobs } = require('./jobs/scheduler');
const repositories = require('./repositories');

async function start() {
  validateEnv();
  await connectDb();
  repositories.readyRepository('companies');
  await ensurePlatformConfig();
  startScheduledJobs();
  app.listen(env.port, () => {
    logger.info(`${env.appName} server listening`, { url: `${env.appUrl}`, port: env.port, nodeEnv: env.nodeEnv });
  });
}

start().catch((error) => {
  logger.error('Startup failed', { error: error.message, stack: error.stack });
  process.exit(1);
});

const { env } = require('./env');
const logger = require('./logger');
const { mongoose } = require('./db');
const { seedMongo, loadSeedModels } = require('../seeds/seedAll');

async function maybeSeedLocalMongo() {
  const shouldSeed = ['true', '1', 'yes'].includes(String(process.env.AUTO_SEED_MONGO || '').toLowerCase());
  if (!shouldSeed || mongoose.connection.readyState !== 1) {
    return { seeded: false, reason: shouldSeed ? 'mongo_not_connected' : 'disabled' };
  }

  loadSeedModels();
  const Listing = mongoose.model('Listing');
  const existingListings = await Listing.countDocuments({});
  if (existingListings > 0 && !['true', '1', 'yes'].includes(String(process.env.AUTO_SEED_FORCE || '').toLowerCase())) {
    logger.info('MongoDB already has data; AUTO_SEED_MONGO skipped', { existingListings });
    return { seeded: false, reason: 'database_not_empty', existingListings };
  }

  logger.info('AUTO_SEED_MONGO enabled; seeding local MongoDB reference data', { mongoUri: env.mongoUri });
  const result = await seedMongo({ fresh: true, disconnect: false });
  logger.info('AUTO_SEED_MONGO completed', result);
  return { seeded: true, ...result };
}

module.exports = { maybeSeedLocalMongo };

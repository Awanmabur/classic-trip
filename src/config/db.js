const mongoose = require('mongoose');
const { env } = require('./env');
const logger = require('./logger');

async function connectDb() {
  if (!env.mongoUri) {
    if (!env.demoMode) {
      throw new Error('MONGO_URI is required for the MongoDB-backed application');
    }
    logger.warn('MONGO_URI is not set; only test-mode empty cache can run without MongoDB.');
    return null;
  }
  try {
    mongoose.set('strictQuery', true);
    const conn = await mongoose.connect(env.mongoUri, {
      serverSelectionTimeoutMS: env.isProduction ? 30000 : 3000,
    });
    logger.info('MongoDB connected', { host: conn.connection.host, db: conn.connection.name });
    return conn;
  } catch (error) {
    if (env.isProduction || !env.demoMode) {
      throw new Error(`MongoDB connection failed: ${error.message}`);
    }
    logger.warn('MongoDB connection failed; continuing only because test/development fallback is explicitly enabled.', { error: error.message });
    return null;
  }
}

module.exports = { connectDb, mongoose };

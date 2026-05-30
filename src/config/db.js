const mongoose = require('mongoose');
const { env } = require('./env');
const logger = require('./logger');

async function connectDb() {
  if (!env.mongoUri) {
    logger.warn('MONGO_URI is not set; using in-memory demo store only.');
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
    if (env.isProduction) throw error;
    logger.warn('MongoDB connection failed; continuing with in-memory demo store.', { error: error.message });
    return null;
  }
}

module.exports = { connectDb, mongoose };

const mongoose = require('mongoose');
const { env } = require('./env');
const logger = require('./logger');

function uriIncludesDatabaseName(uri) {
  try {
    const parsed = new URL(uri);
    return Boolean(String(parsed.pathname || '').replace(/^\/+|\/+$/g, ''));
  } catch (_) {
    return false;
  }
}

async function connectDb() {
  if (!env.mongoUri) throw new Error('MONGO_URI is required for the MongoDB-backed application');
  try {
    mongoose.set('strictQuery', true);
    const effectiveDbName = env.mongoDbName || (uriIncludesDatabaseName(env.mongoUri) ? '' : 'classic-trip');
    const conn = await mongoose.connect(env.mongoUri, {
      serverSelectionTimeoutMS: env.isProduction ? 30000 : 3000,
      ...(effectiveDbName ? { dbName: effectiveDbName } : {}),
    });
    if (env.mongoTransactions) {
      const hello = await conn.connection.db.admin().command({ hello: 1 });
      const supportsTransactions = Boolean(hello.setName) || hello.msg === 'isdbgrid';
      if (!supportsTransactions) {
        await mongoose.disconnect();
        throw new Error('MONGO_TRANSACTIONS=true requires a MongoDB replica set or mongos');
      }
    }
    logger.info('MongoDB connected', { host: conn.connection.host, db: conn.connection.name, transactions: env.mongoTransactions });
    if (conn.connection.name === 'test') {
      logger.warn('MongoDB is connected to the test database. Set MONGO_DB_NAME=classic-trip or include /classic-trip in MONGO_URI before seeding production-like data.');
    }
    return conn;
  } catch (error) {
    throw new Error(`MongoDB connection failed: ${error.message}`);
  }
}

module.exports = { connectDb, mongoose };

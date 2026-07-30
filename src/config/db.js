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

function isRetryableConnectionError(error) {
  if (Number(error?.code) === 18 || /authentication failed/i.test(String(error?.message || ''))) return false;
  const name = String(error?.name || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return name.includes('serverselection')
    || name.includes('network')
    || name.includes('timeout')
    || message.includes('server selection timed out')
    || message.includes('connection timed out')
    || message.includes('connection closed')
    || message.includes('econnreset')
    || message.includes('econnrefused')
    || message.includes('enotfound');
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function connectDb() {
  if (!env.mongoUri) throw new Error('MONGO_URI is required for the MongoDB-backed application');
  mongoose.set('strictQuery', true);
  const effectiveDbName = env.mongoDbName || (uriIncludesDatabaseName(env.mongoUri) ? '' : 'classic-trip');
  const attempts = env.mongoConnection.retryAttempts;
  let lastError = null;
  let attempted = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    attempted = attempt;
    try {
      const conn = await mongoose.connect(env.mongoUri, {
        serverSelectionTimeoutMS: env.mongoConnection.serverSelectionTimeoutMs,
        connectTimeoutMS: env.mongoConnection.connectTimeoutMs,
        socketTimeoutMS: env.mongoConnection.socketTimeoutMs,
        minPoolSize: env.mongoPool.min,
        maxPoolSize: env.mongoPool.max,
        maxConnecting: Math.min(env.mongoPool.max, env.mongoPool.maxConnecting),
        maxIdleTimeMS: env.mongoPool.maxIdleTimeMs,
        waitQueueTimeoutMS: env.mongoPool.waitQueueTimeoutMs,
        heartbeatFrequencyMS: 10000,
        family: env.mongoConnection.ipFamily,
        // Runtime index construction can launch dozens of collection commands
        // during the first dashboard request and exhaust a small Atlas pool.
        // Indexes are installed once by `npm run db:indexes`.
        autoIndex: env.mongoConnection.autoIndex,
        autoCreate: false,
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
      logger.startup('MongoDB connected', { host: conn.connection.host, db: conn.connection.name, transactions: env.mongoTransactions });
      if (conn.connection.name === 'test') {
        logger.warn('MongoDB is connected to the test database. Set MONGO_DB_NAME=classic-trip or include /classic-trip in MONGO_URI before seeding production-like data.');
      }
      return conn;
    } catch (error) {
      lastError = error;
      const shouldRetry = attempt < attempts && isRetryableConnectionError(error);
      if (!shouldRetry) break;
      await mongoose.disconnect().catch(() => {});
      const retryInMs = env.mongoConnection.retryDelayMs * attempt;
      logger.warn('MongoDB connection interrupted; retrying', {
        attempt,
        attempts,
        retryInMs,
        error: error.message,
      });
      await wait(retryInMs);
    }
  }
  const failure = new Error(`MongoDB connection failed after ${attempted} attempt${attempted === 1 ? '' : 's'}: ${lastError?.message || 'unknown error'}`, { cause: lastError });
  failure.code = lastError?.code;
  throw failure;
}

module.exports = { connectDb, mongoose, isRetryableConnectionError };

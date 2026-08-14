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
  // HTTP input is rejected globally when keys contain '$' or '.', and query
  // filters below are constructed by trusted server code. Mongoose's global
  // sanitizeFilter rewrites legitimate internal operators such as $in/$ne
  // into literal values, which breaks availability and other scoped queries.
  // Keep strictQuery enabled and leave sanitizeFilter disabled here; the
  // request-security middleware is the injection boundary.
  mongoose.set('sanitizeFilter', false);
  const effectiveDbName = env.mongoDbName || (uriIncludesDatabaseName(env.mongoUri) ? '' : 'classic-trip');
  const attempts = env.mongoConnection.retryAttempts;
  let lastError = null;
  let attempted = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    attempted = attempt;
    try {
      const isWorker = String(process.env.CLASSIC_TRIP_PROCESS_ROLE || '').toLowerCase() === 'worker';
      const effectivePoolMax = isWorker ? Math.min(env.mongoPool.max, env.mongoPool.workerMax) : env.mongoPool.max;
      const effectivePoolMin = isWorker ? 0 : env.mongoPool.min;
      const conn = await mongoose.connect(env.mongoUri, {
        serverSelectionTimeoutMS: env.mongoConnection.serverSelectionTimeoutMs,
        connectTimeoutMS: env.mongoConnection.connectTimeoutMs,
        socketTimeoutMS: env.mongoConnection.socketTimeoutMs,
        minPoolSize: effectivePoolMin,
        maxPoolSize: effectivePoolMax,
        maxConnecting: Math.min(effectivePoolMax, isWorker ? 2 : env.mongoPool.maxConnecting),
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
      logger.startup('MongoDB connected', { process: process.env.CLASSIC_TRIP_PROCESS_ROLE || 'app', host: conn.connection.host, db: conn.connection.name, transactions: env.mongoTransactions });
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

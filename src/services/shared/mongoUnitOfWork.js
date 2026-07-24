const { mongoose } = require('../../config/db');
const { env } = require('../../config/env');
const logger = require('../../config/logger');

function mongoReady() {
  return mongoose.connection.readyState === 1;
}

function isStandaloneTransactionError(error = {}) {
  const message = String(error.message || error.errmsg || '').toLowerCase();
  return message.includes('transaction numbers are only allowed on a replica set member or mongos')
    || message.includes('transaction numbers are only allowed')
    || message.includes('replica set member or mongos')
    || error.code === 20
    || error.codeName === 'IllegalOperation';
}

function transactionRequiredError(message) {
  const error = new Error(message);
  error.code = 'mongodb_transactions_required';
  error.status = 503;
  return error;
}

// Production business operations fail closed unless MongoDB transactions are explicitly
// enabled and supported by a replica set or mongos. Development may opt out for a local
// standalone instance, but production never falls back to a non-transactional unit of work.
async function runMongoUnitOfWork(work) {
  if (!mongoReady()) throw transactionRequiredError('MongoDB is required for this operation');
  if (!env.mongoTransactions) {
    if (env.isProduction) throw transactionRequiredError('MONGO_TRANSACTIONS=true is required in production');
    return work(null);
  }
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    }, {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      readPreference: 'primary',
    });
    return result;
  } catch (error) {
    if (isStandaloneTransactionError(error)) {
      if (env.isProduction) {
        throw transactionRequiredError('Production MongoDB must be a replica set or mongos with transaction support');
      }
      logger.warn('MongoDB transactions are unavailable; development unit of work is running without a session.', { error: error.message });
      return work(null);
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

function sessionOptions(session, extra = {}) {
  return session ? { ...extra, session } : extra;
}

module.exports = { mongoReady, isStandaloneTransactionError, runMongoUnitOfWork, sessionOptions };

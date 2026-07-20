const { mongoose } = require('../../config/db');
const { env } = require('../../config/env');

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

// Runs `work(session)` inside a real Mongo transaction when MONGO_TRANSACTIONS is enabled
// and the deployment supports it (Atlas/replica set/mongos). Falls back to running `work(null)`
// without a session on standalone MongoDB (e.g. local dev) or when transactions aren't configured,
// since atomic per-document operations (findOneAndUpdate) still protect inventory in that case.
async function runMongoUnitOfWork(work) {
  if (!mongoReady()) return work(null);
  if (!env.mongoTransactions) return work(null);
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    }, {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
    });
    return result;
  } catch (error) {
    if (isStandaloneTransactionError(error)) {
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

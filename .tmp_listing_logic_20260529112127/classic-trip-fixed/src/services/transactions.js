const mongoose = require("mongoose");

let transactionSupportPromise = null;

async function supportsMongoTransactions() {
  if (transactionSupportPromise) return transactionSupportPromise;

  transactionSupportPromise = (async () => {
    try {
      const admin = mongoose.connection?.db?.admin?.();
      if (!admin) return false;
      const hello = await admin.command({ hello: 1 });
      return Boolean(hello.setName || hello.msg === "isdbgrid");
    } catch (_err) {
      return false;
    }
  })();

  return transactionSupportPromise;
}

async function runWithOptionalTransaction(work) {
  if (await supportsMongoTransactions()) {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        result = await work(session);
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  return work(null);
}

function withSession(query, session) {
  return session ? query.session(session) : query;
}

function createOptions(session) {
  return session ? { session } : undefined;
}

module.exports = {
  supportsMongoTransactions,
  runWithOptionalTransaction,
  withSession,
  createOptions
};

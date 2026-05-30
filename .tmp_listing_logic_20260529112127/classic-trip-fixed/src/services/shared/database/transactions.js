const mongoose = require("mongoose");
const { platformConnection } = require("../../../config/database");

const transactionSupportCache = new WeakMap();

function normalizedConnection(connection = null) {
  return connection || platformConnection || mongoose.connection;
}

async function supportsMongoTransactions(connection = null) {
  const resolvedConnection = normalizedConnection(connection);
  if (transactionSupportCache.has(resolvedConnection)) {
    return transactionSupportCache.get(resolvedConnection);
  }

  const probe = (async () => {
    try {
      const admin = resolvedConnection?.db?.admin?.();
      if (!admin) return false;
      const hello = await admin.command({ hello: 1 });
      return Boolean(hello.setName || hello.msg === "isdbgrid");
    } catch (_err) {
      return false;
    }
  })();

  transactionSupportCache.set(resolvedConnection, probe);
  return probe;
}

async function runWithOptionalTransaction(connectionOrWork, maybeWork) {
  const work = typeof connectionOrWork === "function" ? connectionOrWork : maybeWork;
  const connection = typeof connectionOrWork === "function" ? null : connectionOrWork;
  const resolvedConnection = normalizedConnection(connection);

  if (await supportsMongoTransactions(resolvedConnection)) {
    const session = await resolvedConnection.startSession();
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

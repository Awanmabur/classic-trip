const { MongoCollection } = require('./mongoCollection');
const { runMongoUnitOfWork } = require('../../services/shared/mongoUnitOfWork');
const crypto = require('crypto');
const { duplicateKeyFields } = require('../../utils/mongoDuplicate');

const financeRepository = {
  wallets: new MongoCollection('wallets'),
  transactions: new MongoCollection('walletTransactions'),
  payments: new MongoCollection('payments'),
  commissions: new MongoCollection('commissions'),
  paymentIntents: new MongoCollection('paymentIntents'),
  receiptInvoices: new MongoCollection('receiptInvoices'),
  taxFeeRecords: new MongoCollection('taxFeeRecords'),
  statements: new MongoCollection('financeStatements'),
  riskReviews: new MongoCollection('financeRiskReviews'),
  settlementBatches: new MongoCollection('settlementBatches'),
  payoutRequests: new MongoCollection('payoutRequests'),
  payoutBatches: new MongoCollection('payoutBatches'),
  reconciliationReports: new MongoCollection('reconciliationReports'),
  bookings: new MongoCollection('bookings'),
  refunds: new MongoCollection('refundRequests'),
  companies: new MongoCollection('companies'),
  users: new MongoCollection('users'),
  auditLogs: new MongoCollection('auditLogs'),
};

async function withTransaction(work) {
  return runMongoUnitOfWork(work);
}

function walletFilter(ownerType, ownerId, currency) {
  return { ownerType, ownerId, currency };
}

async function atomicWalletDelta({ ownerType, ownerId, currency, availableDelta = 0, pendingDelta = 0, requireAvailable = 0, session = null, walletId }) {
  const filter = walletFilter(ownerType, ownerId, currency);
  if (requireAvailable > 0) filter.availableBalance = { $gte: requireAvailable };
  financeRepository.wallets.assertReady();
  const Model = financeRepository.wallets.repository.Model;
  const increments = {
    availableBalance: Number(availableDelta || 0),
    pendingBalance: Number(pendingDelta || 0),
  };
  const options = {
    new: true,
    upsert: requireAvailable <= 0,
    runValidators: true,
    setDefaultsOnInsert: false,
    session: session || undefined,
    lean: true,
  };

  let wallet = null;
  let candidateWalletId = walletId || `wallet-${crypto.randomUUID()}`;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const update = {
      $setOnInsert: {
        id: candidateWalletId,
        ownerType,
        ownerId,
        currency,
      },
      $inc: increments,
    };

    try {
      wallet = await Model.findOneAndUpdate(filter, update, options);
      break;
    } catch (error) {
      const duplicateFields = duplicateKeyFields(error);
      const walletIdentityRace = Number(error?.code) === 11000
        && ['ownerType', 'ownerId', 'currency'].some((field) => duplicateFields.includes(field));
      if (walletIdentityRace) {
        wallet = await Model.findOneAndUpdate(filter, { $inc: increments }, {
          ...options,
          upsert: false,
          setDefaultsOnInsert: false,
        });
        break;
      }

      const identifierCollision = Number(error?.code) === 11000 && duplicateFields.includes('id');
      if (identifierCollision && options.upsert && attempt < 5) {
        candidateWalletId = `wallet-${crypto.randomUUID()}`;
        continue;
      }
      throw error;
    }
  }

  if (!wallet) return null;
  const plain = { ...wallet, id: wallet.id || String(wallet._id) };
  delete plain._id;
  delete plain.__v;
  return plain;
}

module.exports = { ...financeRepository, withTransaction, walletFilter, atomicWalletDelta };

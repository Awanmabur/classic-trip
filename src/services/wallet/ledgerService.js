const { platformCurrency } = require('../../utils/currency');
const financeRepository = require('../../repositories/domain/financeRepository');
const { nextId } = require('../data/idService');

async function recordTransaction(transaction, options = {}) {
  const entry = {
    id: transaction.id || await nextId('txn'),
    currency: transaction.currency || platformCurrency(),
    status: transaction.status || 'pending',
    createdAt: transaction.createdAt || new Date().toISOString(),
    ...transaction,
  };
  await financeRepository.transactions.save(entry, { id: entry.id }, { session: options.session || undefined });
  return entry;
}

async function findTransactionsLive(filter = {}, options = {}) {
  return financeRepository.transactions.list(filter, options);
}

async function updateTransactions(filter = {}, changes = {}, options = {}) {
  const updatedAt = new Date().toISOString();
  await financeRepository.transactions.updateMany(filter, { $set: { ...changes, updatedAt } }, { session: options.session || undefined, runValidators: true });
  return financeRepository.transactions.list(filter, options);
}

module.exports = { recordTransaction, findTransactions: findTransactionsLive, findTransactionsLive, updateTransactions };

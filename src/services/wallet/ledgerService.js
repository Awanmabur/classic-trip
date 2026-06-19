const store = require('../data/persistentStore');

function recordTransaction(transaction) {
  const entry = {
    id: `txn-${store.state.walletTransactions.length + 1}`,
    currency: 'UGX',
    status: 'pending',
    createdAt: new Date().toISOString(),
    ...transaction,
  };
  store.state.walletTransactions.push(entry);
  return entry;
}

function findTransactions(filter = {}) {
  return store.state.walletTransactions.filter((txn) => Object.entries(filter).every(([key, value]) => txn[key] === value));
}

function updateTransactions(filter = {}, changes = {}) {
  const rows = findTransactions(filter);
  rows.forEach((txn) => Object.assign(txn, changes, { updatedAt: new Date().toISOString() }));
  return rows;
}

module.exports = { recordTransaction, findTransactions, updateTransactions };

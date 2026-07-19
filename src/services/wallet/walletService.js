const store = require('../data/persistentStore');
const ledgerService = require('./ledgerService');

function getWallet(ownerType, ownerId) {
  return store.state.wallets.find((wallet) => wallet.ownerType === ownerType && wallet.ownerId === ownerId);
}

function getOrCreateWallet(ownerType, ownerId, currency = 'UGX') {
  let wallet = getWallet(ownerType, ownerId);
  if (!wallet) {
    wallet = { id: `wallet-${store.state.wallets.length + 1}`, ownerType, ownerId, currency, availableBalance: 0, pendingBalance: 0 };
    store.state.wallets.push(wallet);
  }
  return wallet;
}

function normalizeAmount(amount) {
  return Math.max(0, Number(amount) || 0);
}

function creditPending(ownerType, ownerId, amount, meta = {}) {
  const value = normalizeAmount(amount);
  const wallet = getOrCreateWallet(ownerType, ownerId, meta.currency || 'UGX');
  wallet.pendingBalance += value;
  ledgerService.recordTransaction({
    walletId: wallet.id,
    ownerType,
    ownerId,
    transactionType: meta.transactionType || 'earning_pending',
    direction: 'credit',
    amount: value,
    currency: wallet.currency,
    status: meta.status || 'pending',
    referenceType: meta.referenceType,
    referenceId: meta.referenceId,
  });
  return wallet;
}

function creditAvailable(ownerType, ownerId, amount, meta = {}) {
  const value = normalizeAmount(amount);
  const wallet = getOrCreateWallet(ownerType, ownerId, meta.currency || 'UGX');
  wallet.availableBalance += value;
  ledgerService.recordTransaction({
    walletId: wallet.id,
    ownerType,
    ownerId,
    transactionType: meta.transactionType || 'credit',
    direction: 'credit',
    amount: value,
    currency: wallet.currency,
    status: meta.status || 'completed',
    referenceType: meta.referenceType,
    referenceId: meta.referenceId,
  });
  return wallet;
}

function debitAvailable(ownerType, ownerId, amount, meta = {}) {
  const value = normalizeAmount(amount);
  const wallet = getOrCreateWallet(ownerType, ownerId, meta.currency || 'UGX');
  if (wallet.availableBalance < value) {
    const error = new Error('Insufficient wallet balance');
    error.status = 409;
    throw error;
  }
  wallet.availableBalance -= value;
  ledgerService.recordTransaction({
    walletId: wallet.id,
    ownerType,
    ownerId,
    transactionType: meta.transactionType || 'debit',
    direction: 'debit',
    amount: value,
    currency: wallet.currency,
    status: meta.status || 'completed',
    referenceType: meta.referenceType,
    referenceId: meta.referenceId,
  });
  return wallet;
}

function reverseEarning(ownerType, ownerId, amount, meta = {}) {
  const value = normalizeAmount(amount);
  const wallet = getOrCreateWallet(ownerType, ownerId, meta.currency || 'UGX');
  const pendingDebit = Math.min(wallet.pendingBalance, value);
  const availableDebit = Math.min(wallet.availableBalance, value - pendingDebit);
  const uncoveredAmount = Math.max(0, value - pendingDebit - availableDebit);
  wallet.pendingBalance -= pendingDebit;
  wallet.availableBalance -= availableDebit;
  const transaction = ledgerService.recordTransaction({
    walletId: wallet.id,
    ownerType,
    ownerId,
    transactionType: meta.transactionType || 'refund_debit',
    direction: 'debit',
    amount: value,
    currency: wallet.currency,
    status: uncoveredAmount > 0 ? 'partial' : (meta.status || 'completed'),
    referenceType: meta.referenceType,
    referenceId: meta.referenceId,
    sourceReferenceType: meta.sourceReferenceType,
    sourceReferenceId: meta.sourceReferenceId,
    pendingDebit,
    availableDebit,
    uncoveredAmount,
  });
  return { wallet, transaction };
}

function movePendingToAvailable(ownerType, ownerId, amount, meta = {}) {
  const value = normalizeAmount(amount);
  const wallet = getOrCreateWallet(ownerType, ownerId, meta.currency || 'UGX');
  wallet.pendingBalance = Math.max(0, wallet.pendingBalance - value);
  wallet.availableBalance += value;
  ledgerService.recordTransaction({
    walletId: wallet.id,
    ownerType,
    ownerId,
    transactionType: meta.transactionType || 'earning_released',
    direction: 'credit',
    amount: value,
    currency: wallet.currency,
    status: 'completed',
    referenceType: meta.referenceType,
    referenceId: meta.referenceId,
  });
  return wallet;
}

function requestWithdrawal(ownerType, ownerId, amount, meta = {}) {
  const value = normalizeAmount(amount);
  if (value <= 0) {
    const error = new Error('Withdrawal amount must be greater than zero');
    error.status = 422;
    throw error;
  }
  const transactionStartIndex = store.state.walletTransactions.length;
  const wallet = debitAvailable(ownerType, ownerId, value, {
    ...meta,
    transactionType: meta.transactionType || 'withdrawal_request',
    status: 'pending',
  });
  return { wallet, transaction: store.state.walletTransactions[transactionStartIndex] || null };
}

function reviewTopUpRequest(transactionId, action, adminId = 'admin-system', meta = {}) {
  const transaction = store.state.walletTransactions.find((txn) => txn.id === transactionId);
  if (!transaction) return null;
  if (transaction.transactionType !== 'wallet_top_up_request') {
    const error = new Error('This transaction is not a wallet top-up request');
    error.status = 422;
    throw error;
  }
  if (transaction.status !== 'pending') {
    const error = new Error(`Cannot review a top-up request that is already '${transaction.status}'`);
    error.status = 409;
    throw error;
  }
  if (String(action || '').toLowerCase() === 'rejected') {
    reverseEarning(transaction.ownerType, transaction.ownerId, transaction.amount, {
      currency: transaction.currency,
      transactionType: 'wallet_top_up_rejected',
      referenceType: transaction.referenceType,
      referenceId: transaction.referenceId,
    });
    transaction.status = 'rejected';
    transaction.rejectedBy = adminId;
    transaction.rejectedAt = new Date().toISOString();
    transaction.rejectionReason = meta.reason || '';
  } else {
    movePendingToAvailable(transaction.ownerType, transaction.ownerId, transaction.amount, {
      currency: transaction.currency,
      transactionType: 'wallet_top_up_approved',
      referenceType: transaction.referenceType,
      referenceId: transaction.referenceId,
    });
    transaction.status = 'completed';
    transaction.approvedBy = adminId;
    transaction.approvedAt = new Date().toISOString();
  }
  return transaction;
}

const FINAL_WITHDRAWAL_STATUSES = new Set(['completed', 'rejected']);

function assertIsWithdrawal(transaction) {
  if (transaction.transactionType !== 'withdrawal_request') {
    const error = new Error('This transaction is not a withdrawal/payout request');
    error.status = 422;
    throw error;
  }
}

function approveWithdrawal(transactionId, adminId = 'admin-system') {
  const transaction = store.state.walletTransactions.find((txn) => txn.id === transactionId);
  if (!transaction) return null;
  assertIsWithdrawal(transaction);
  if (FINAL_WITHDRAWAL_STATUSES.has(transaction.status)) {
    const error = new Error(`Cannot approve a withdrawal that is already '${transaction.status}'`);
    error.status = 409;
    throw error;
  }
  transaction.status = 'completed';
  transaction.approvedBy = adminId;
  transaction.approvedAt = new Date().toISOString();
  return transaction;
}

function rejectWithdrawal(transactionId, adminId = 'admin-system', meta = {}) {
  const transaction = store.state.walletTransactions.find((txn) => txn.id === transactionId);
  if (!transaction) return null;
  assertIsWithdrawal(transaction);
  if (FINAL_WITHDRAWAL_STATUSES.has(transaction.status)) {
    const error = new Error(`Cannot reject a withdrawal that is already '${transaction.status}'`);
    error.status = 409;
    throw error;
  }
  creditAvailable(transaction.ownerType, transaction.ownerId, transaction.amount, {
    currency: transaction.currency,
    transactionType: 'withdrawal_reversal',
    referenceType: transaction.referenceType,
    referenceId: transaction.referenceId,
    status: 'completed',
  });
  transaction.status = 'rejected';
  transaction.rejectedBy = adminId;
  transaction.rejectedAt = new Date().toISOString();
  transaction.rejectionReason = meta.reason || transaction.rejectionReason || '';
  return transaction;
}

module.exports = {
  getWallet,
  getOrCreateWallet,
  creditPending,
  creditAvailable,
  debitAvailable,
  reverseEarning,
  movePendingToAvailable,
  requestWithdrawal,
  approveWithdrawal,
  rejectWithdrawal,
  reviewTopUpRequest,
};

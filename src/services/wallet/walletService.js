const store = require('../data/persistentStore');
const ledgerService = require('./ledgerService');
const { nextId } = require('../data/idService');

function getWallet(ownerType, ownerId, currency) {
  return store.state.wallets.find((wallet) => wallet.ownerType === ownerType && wallet.ownerId === ownerId && wallet.currency === currency);
}

// currency is required and never defaulted: silently defaulting to 'UGX' here is exactly what
// let a second currency's amounts get added onto a first-currency wallet's balance as if they
// were the same unit. Every caller must know and pass the real currency of the money involved.
async function getOrCreateWallet(ownerType, ownerId, currency) {
  if (!currency) {
    const error = new Error('currency is required to resolve a wallet');
    error.status = 422;
    throw error;
  }
  let wallet = getWallet(ownerType, ownerId, currency);
  if (!wallet) {
    wallet = { id: await nextId('wallet'), ownerType, ownerId, currency, availableBalance: 0, pendingBalance: 0 };
    store.state.wallets.push(wallet);
  }
  return wallet;
}

function normalizeAmount(amount) {
  return Math.max(0, Number(amount) || 0);
}

async function creditPending(ownerType, ownerId, currency, amount, meta = {}) {
  const value = normalizeAmount(amount);
  const wallet = await getOrCreateWallet(ownerType, ownerId, currency);
  wallet.pendingBalance += value;
  await ledgerService.recordTransaction({
    walletId: wallet.id,
    ownerType,
    ownerId,
    transactionType: meta.transactionType || 'earning_pending',
    direction: 'credit',
    amount: value,
    currency,
    status: meta.status || 'pending',
    referenceType: meta.referenceType,
    referenceId: meta.referenceId,
  });
  return wallet;
}

async function creditAvailable(ownerType, ownerId, currency, amount, meta = {}) {
  const value = normalizeAmount(amount);
  const wallet = await getOrCreateWallet(ownerType, ownerId, currency);
  wallet.availableBalance += value;
  await ledgerService.recordTransaction({
    walletId: wallet.id,
    ownerType,
    ownerId,
    transactionType: meta.transactionType || 'credit',
    direction: 'credit',
    amount: value,
    currency,
    status: meta.status || 'completed',
    referenceType: meta.referenceType,
    referenceId: meta.referenceId,
  });
  return wallet;
}

async function debitAvailable(ownerType, ownerId, currency, amount, meta = {}) {
  const value = normalizeAmount(amount);
  const wallet = await getOrCreateWallet(ownerType, ownerId, currency);
  if (wallet.availableBalance < value) {
    const error = new Error('Insufficient wallet balance');
    error.status = 409;
    throw error;
  }
  wallet.availableBalance -= value;
  await ledgerService.recordTransaction({
    walletId: wallet.id,
    ownerType,
    ownerId,
    transactionType: meta.transactionType || 'debit',
    direction: 'debit',
    amount: value,
    currency,
    status: meta.status || 'completed',
    referenceType: meta.referenceType,
    referenceId: meta.referenceId,
  });
  return wallet;
}

async function reverseEarning(ownerType, ownerId, currency, amount, meta = {}) {
  const value = normalizeAmount(amount);
  const wallet = await getOrCreateWallet(ownerType, ownerId, currency);
  const pendingDebit = Math.min(wallet.pendingBalance, value);
  const availableDebit = Math.min(wallet.availableBalance, value - pendingDebit);
  const uncoveredAmount = Math.max(0, value - pendingDebit - availableDebit);
  wallet.pendingBalance -= pendingDebit;
  wallet.availableBalance -= availableDebit;
  const transaction = await ledgerService.recordTransaction({
    walletId: wallet.id,
    ownerType,
    ownerId,
    transactionType: meta.transactionType || 'refund_debit',
    direction: 'debit',
    amount: value,
    currency,
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

async function movePendingToAvailable(ownerType, ownerId, currency, amount, meta = {}) {
  const value = normalizeAmount(amount);
  const wallet = await getOrCreateWallet(ownerType, ownerId, currency);
  wallet.pendingBalance = Math.max(0, wallet.pendingBalance - value);
  wallet.availableBalance += value;
  await ledgerService.recordTransaction({
    walletId: wallet.id,
    ownerType,
    ownerId,
    transactionType: meta.transactionType || 'earning_released',
    direction: 'credit',
    amount: value,
    currency,
    status: 'completed',
    referenceType: meta.referenceType,
    referenceId: meta.referenceId,
  });
  return wallet;
}

async function requestWithdrawal(ownerType, ownerId, currency, amount, meta = {}) {
  const value = normalizeAmount(amount);
  if (value <= 0) {
    const error = new Error('Withdrawal amount must be greater than zero');
    error.status = 422;
    throw error;
  }
  const transactionStartIndex = store.state.walletTransactions.length;
  const wallet = await debitAvailable(ownerType, ownerId, currency, value, {
    ...meta,
    transactionType: meta.transactionType || 'withdrawal_request',
    status: 'pending',
  });
  return { wallet, transaction: store.state.walletTransactions[transactionStartIndex] || null };
}

async function reviewTopUpRequest(transactionId, action, adminId = 'admin-system', meta = {}) {
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
    await reverseEarning(transaction.ownerType, transaction.ownerId, transaction.currency, transaction.amount, {
      transactionType: 'wallet_top_up_rejected',
      referenceType: transaction.referenceType,
      referenceId: transaction.referenceId,
    });
    transaction.status = 'rejected';
    transaction.rejectedBy = adminId;
    transaction.rejectedAt = new Date().toISOString();
    transaction.rejectionReason = meta.reason || '';
  } else {
    await movePendingToAvailable(transaction.ownerType, transaction.ownerId, transaction.currency, transaction.amount, {
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

async function rejectWithdrawal(transactionId, adminId = 'admin-system', meta = {}) {
  const transaction = store.state.walletTransactions.find((txn) => txn.id === transactionId);
  if (!transaction) return null;
  assertIsWithdrawal(transaction);
  if (FINAL_WITHDRAWAL_STATUSES.has(transaction.status)) {
    const error = new Error(`Cannot reject a withdrawal that is already '${transaction.status}'`);
    error.status = 409;
    throw error;
  }
  await creditAvailable(transaction.ownerType, transaction.ownerId, transaction.currency, transaction.amount, {
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

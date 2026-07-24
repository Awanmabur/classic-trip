const financeRepository = require('../../repositories/domain/financeRepository');
const ledgerService = require('./ledgerService');
const { nextId } = require('../data/idService');

async function getWalletLive(ownerType, ownerId, currency, options = {}) {
  return financeRepository.wallets.findOne({ ownerType, ownerId, currency }, options);
}

function requireCurrency(currency) {
  if (!currency) {
    const error = new Error('currency is required to resolve a wallet');
    error.status = 422;
    throw error;
  }
}

async function getOrCreateWallet(ownerType, ownerId, currency, options = {}) {
  requireCurrency(currency);
  const existing = await getWalletLive(ownerType, ownerId, currency, options);
  if (existing) {
    return existing;
  }
  const wallet = {
    id: await nextId('wallet'),
    ownerType,
    ownerId,
    currency,
    availableBalance: 0,
    pendingBalance: 0,
  };
  return financeRepository.atomicWalletDelta({ ownerType, ownerId, currency, walletId: wallet.id, session: options.session || null });
}

function normalizeAmount(amount) {
  return Math.max(0, Number(amount) || 0);
}

async function applyMovement({ ownerType, ownerId, currency, amount, availableDelta = 0, pendingDelta = 0, requireAvailable = 0, transaction, session = null }) {
  requireCurrency(currency);
  const value = normalizeAmount(amount);
  const existingWallet = await getWalletLive(ownerType, ownerId, currency, { session });
  const walletId = existingWallet?.id || await nextId('wallet');
  const wallet = await financeRepository.atomicWalletDelta({
    ownerType,
    ownerId,
    currency,
    availableDelta: Number(availableDelta || 0),
    pendingDelta: Number(pendingDelta || 0),
    requireAvailable,
    walletId,
    session,
  });
  if (!wallet) {
    const error = new Error('Insufficient wallet balance');
    error.status = 409;
    throw error;
  }
  const entry = await ledgerService.recordTransaction({
    walletId: wallet.id,
    ownerType,
    ownerId,
    amount: value,
    currency,
    ...transaction,
  }, { session });
  return { wallet, transaction: entry };
}

async function creditPending(ownerType, ownerId, currency, amount, meta = {}) {
  const value = normalizeAmount(amount);
  const work = async (session) => (await applyMovement({
    ownerType, ownerId, currency, amount: value, pendingDelta: value, session,
    transaction: {
      transactionType: meta.transactionType || 'earning_pending',
      direction: 'credit',
      status: meta.status || 'pending',
      referenceType: meta.referenceType,
      referenceId: meta.referenceId,
      meta: meta.meta,
    },
  })).wallet;
  return meta.session ? work(meta.session) : financeRepository.withTransaction(work);
}

async function creditAvailable(ownerType, ownerId, currency, amount, meta = {}) {
  const value = normalizeAmount(amount);
  const work = async (session) => (await applyMovement({
    ownerType, ownerId, currency, amount: value, availableDelta: value, session,
    transaction: {
      transactionType: meta.transactionType || 'credit',
      direction: 'credit',
      status: meta.status || 'completed',
      referenceType: meta.referenceType,
      referenceId: meta.referenceId,
      meta: meta.meta,
    },
  })).wallet;
  return meta.session ? work(meta.session) : financeRepository.withTransaction(work);
}

async function debitAvailable(ownerType, ownerId, currency, amount, meta = {}) {
  const value = normalizeAmount(amount);
  return financeRepository.withTransaction(async (session) => (await applyMovement({
    ownerType, ownerId, currency, amount: value, availableDelta: -value, requireAvailable: value, session,
    transaction: {
      transactionType: meta.transactionType || 'debit',
      direction: 'debit',
      status: meta.status || 'completed',
      referenceType: meta.referenceType,
      referenceId: meta.referenceId,
      meta: meta.meta,
    },
  })).wallet);
}

async function reverseEarning(ownerType, ownerId, currency, amount, meta = {}) {
  const value = normalizeAmount(amount);
  return financeRepository.withTransaction(async (session) => {
    const current = await getOrCreateWallet(ownerType, ownerId, currency, { session });
    const pendingDebit = Math.min(Number(current.pendingBalance || 0), value);
    const availableDebit = Math.min(Number(current.availableBalance || 0), value - pendingDebit);
    const uncoveredAmount = Math.max(0, value - pendingDebit - availableDebit);
    const result = await applyMovement({
      ownerType,
      ownerId,
      currency,
      amount: value,
      pendingDelta: -pendingDebit,
      availableDelta: -availableDebit,
      session,
      transaction: {
        transactionType: meta.transactionType || 'refund_debit',
        direction: 'debit',
        status: uncoveredAmount > 0 ? 'held' : (meta.status || 'completed'),
        referenceType: meta.referenceType,
        referenceId: meta.referenceId,
        sourceReferenceType: meta.sourceReferenceType,
        sourceReferenceId: meta.sourceReferenceId,
        pendingDebit,
        availableDebit,
        uncoveredAmount,
      },
    });
    return result;
  });
}

async function movePendingToAvailable(ownerType, ownerId, currency, amount, meta = {}) {
  const value = normalizeAmount(amount);
  return financeRepository.withTransaction(async (session) => {
    const wallet = await getOrCreateWallet(ownerType, ownerId, currency, { session });
    const releasable = Math.min(Number(wallet.pendingBalance || 0), value);
    return (await applyMovement({
      ownerType, ownerId, currency, amount: releasable, pendingDelta: -releasable, availableDelta: releasable, session,
      transaction: {
        transactionType: meta.transactionType || 'earning_released',
        direction: 'credit',
        status: 'completed',
        referenceType: meta.referenceType,
        referenceId: meta.referenceId,
        meta: { requestedAmount: value, ...(meta.meta || {}) },
      },
    })).wallet;
  });
}

async function requestWithdrawal(ownerType, ownerId, currency, amount, meta = {}) {
  const value = normalizeAmount(amount);
  if (value <= 0) {
    const error = new Error('Withdrawal amount must be greater than zero');
    error.status = 422;
    throw error;
  }
  return financeRepository.withTransaction(async (session) => applyMovement({
    ownerType, ownerId, currency, amount: value, availableDelta: -value, requireAvailable: value, session,
    transaction: {
      transactionType: 'withdrawal_request',
      direction: 'debit',
      status: 'pending',
      referenceType: meta.referenceType || 'withdrawal',
      referenceId: meta.referenceId,
      payoutMethod: meta.payoutMethod,
      payoutAccount: meta.payoutAccount,
      meta: meta.meta,
    },
  }));
}

async function transactionById(transactionId) {
  return financeRepository.transactions.findOne({ id: transactionId });
}

async function reviewTopUpRequest(transactionId, action, adminId = 'admin-system', meta = {}) {
  const transaction = await transactionById(transactionId);
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
      transactionType: 'wallet_top_up_rejected', referenceType: transaction.referenceType, referenceId: transaction.referenceId,
    });
    Object.assign(transaction, { status: 'rejected', rejectedBy: adminId, rejectedAt: new Date().toISOString(), rejectionReason: meta.reason || '' });
  } else {
    await movePendingToAvailable(transaction.ownerType, transaction.ownerId, transaction.currency, transaction.amount, {
      transactionType: 'wallet_top_up_approved', referenceType: transaction.referenceType, referenceId: transaction.referenceId,
    });
    Object.assign(transaction, { status: 'completed', approvedBy: adminId, approvedAt: new Date().toISOString() });
  }
  await financeRepository.transactions.save(transaction, { id: transaction.id });
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

async function approveWithdrawalPersisted(transactionId, adminId = 'admin-system') {
  const transaction = await transactionById(transactionId);
  if (!transaction) return null;
  assertIsWithdrawal(transaction);
  if (FINAL_WITHDRAWAL_STATUSES.has(transaction.status) && !transaction.approvedAt) {
    const error = new Error(`Cannot approve a withdrawal that is already '${transaction.status}'`);
    error.status = 409;
    throw error;
  }
  Object.assign(transaction, { status: 'completed', approvedBy: transaction.approvedBy || adminId, approvedAt: transaction.approvedAt || new Date().toISOString() });
  await financeRepository.transactions.save(transaction, { id: transaction.id });
  return transaction;
}

async function rejectWithdrawal(transactionId, adminId = 'admin-system', meta = {}) {
  const transaction = await transactionById(transactionId);
  if (!transaction) return null;
  assertIsWithdrawal(transaction);
  if (FINAL_WITHDRAWAL_STATUSES.has(transaction.status)) {
    const error = new Error(`Cannot reject a withdrawal that is already '${transaction.status}'`);
    error.status = 409;
    throw error;
  }
  await creditAvailable(transaction.ownerType, transaction.ownerId, transaction.currency, transaction.amount, {
    transactionType: 'withdrawal_reversal', referenceType: transaction.referenceType, referenceId: transaction.referenceId,
  });
  Object.assign(transaction, { status: 'rejected', rejectedBy: adminId, rejectedAt: new Date().toISOString(), rejectionReason: meta.reason || transaction.rejectionReason || '' });
  await financeRepository.transactions.save(transaction, { id: transaction.id });
  return transaction;
}

module.exports = {
  getWallet: getWalletLive, getWalletLive, getOrCreateWallet, creditPending, creditAvailable, debitAvailable,
  reverseEarning, movePendingToAvailable, requestWithdrawal, approveWithdrawal: approveWithdrawalPersisted, rejectWithdrawal,
  reviewTopUpRequest, approveWithdrawalPersisted,
};

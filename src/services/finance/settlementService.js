const store = require('../data/persistentStore');
const walletService = require('../wallet/walletService');
const ledgerService = require('../wallet/ledgerService');
const commissionService = require('../commission/commissionService');
const releaseService = require('../commission/releaseService');
const notificationService = require('../notification/notificationService');
const { mongoose } = require('../../config/db');
const { nextId: atomicNextId } = require('../data/idService');

function mongoReady() {
  return mongoose.connection.readyState === 1;
}

async function upsertModel(modelName, row, filter = { id: row.id }) {
  if (!mongoReady() || !row) return;
  const Model = require(`../../models/${modelName}`);
  await Model.updateOne(filter, { $set: row }, { upsert: true, runValidators: true });
}

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

function normalize(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, '_');
}

function amountValue(value, fallback = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const amount = Number(String(value || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(amount) ? amount : fallback;
}

function ensureCollections() {
  if (!Array.isArray(store.state.settlementBatches)) store.state.settlementBatches = [];
  if (!Array.isArray(store.state.payoutRequests)) store.state.payoutRequests = [];
  if (!Array.isArray(store.state.payoutBatches)) store.state.payoutBatches = [];
  if (!Array.isArray(store.state.reconciliationReports)) store.state.reconciliationReports = [];
  if (!Array.isArray(store.state.auditLogs)) store.state.auditLogs = [];
  if (!Array.isArray(store.state.walletTransactions)) store.state.walletTransactions = [];
  if (!Array.isArray(store.state.commissions)) store.state.commissions = [];
  if (!Array.isArray(store.state.paymentIntents)) store.state.paymentIntents = [];
  if (!Array.isArray(store.state.receiptInvoices)) store.state.receiptInvoices = [];
  if (!Array.isArray(store.state.taxFeeRecords)) store.state.taxFeeRecords = [];
  if (!Array.isArray(store.state.financeStatements)) store.state.financeStatements = [];
  if (!Array.isArray(store.state.financeRiskReviews)) store.state.financeRiskReviews = [];
}

// Audit-log IDs are intentionally left on the legacy in-memory-length scheme: audit rows are
// append-only supplementary records (not primary entity data), audit() is called synchronously
// from dozens of places throughout this file, and a rare colliding audit id merely overwrites
// one log entry rather than corrupting booking/seat/schedule data. Not worth the async blast
// radius of converting every audit() call site — unlike the entity IDs below, which now use
// idService's atomic counter.
function legacyNextId(prefix, rows = []) {
  let index = rows.length + 1;
  let id = `${prefix}-${index}`;
  while (rows.some((row) => row.id === id)) {
    index += 1;
    id = `${prefix}-${index}`;
  }
  return id;
}

function audit(actorId, action, target, meta = {}) {
  ensureCollections();
  const row = {
    id: legacyNextId('audit', store.state.auditLogs),
    actorId: actorId || 'finance-system',
    action,
    target,
    metadata: meta,
    createdAt: new Date().toISOString(),
  };
  store.state.auditLogs.push(row);
  return row;
}

function bookingEligibleForRelease(booking = {}) {
  return ['checked_in', 'completed'].includes(normalize(booking.bookingStatus || booking.checkInStatus));
}


function ref(prefix, rows = []) {
  return `${prefix}-${String(rows.length + 1).padStart(6, '0')}`;
}

async function recordPaymentIntent(payload = {}, actorId = 'payment-system') {
  ensureCollections();
  const idempotencyKey = cleanText(payload.idempotencyKey || `${payload.provider || 'mock'}:${payload.bookingRef || payload.cartRef || 'general'}:${payload.amount || 0}`);
  let intent = store.state.paymentIntents.find((item) => item.idempotencyKey === idempotencyKey);
  if (!intent) {
    intent = {
      id: await atomicNextId('payment-intent'),
      intentRef: ref('PI', store.state.paymentIntents),
      bookingId: cleanText(payload.bookingId || ''),
      bookingRef: cleanText(payload.bookingRef || ''),
      cartRef: cleanText(payload.cartRef || ''),
      companyId: cleanText(payload.companyId || ''),
      customerUserId: cleanText(payload.customerUserId || ''),
      provider: cleanText(payload.provider || 'mock'),
      providerReference: cleanText(payload.providerReference || ''),
      idempotencyKey,
      amount: amountValue(payload.amount),
      currency: cleanText(payload.currency || 'UGX'),
      status: cleanText(payload.status || 'created'),
      checkoutUrl: cleanText(payload.checkoutUrl || ''),
      attempts: [],
      metadata: payload.metadata || {},
      createdBy: actorId,
      createdAt: new Date().toISOString(),
      expiresAt: payload.expiresAt || null,
    };
    store.state.paymentIntents.unshift(intent);
  }
  intent.providerReference = cleanText(payload.providerReference || intent.providerReference || '');
  intent.status = cleanText(payload.status || intent.status || 'created');
  intent.checkoutUrl = cleanText(payload.checkoutUrl || intent.checkoutUrl || '');
  intent.updatedAt = new Date().toISOString();
  intent.attempts.push({ status: intent.status, providerReference: intent.providerReference, at: intent.updatedAt });
  if (intent.status === 'successful') intent.paidAt = new Date().toISOString();
  if (intent.status === 'failed') intent.failedAt = new Date().toISOString();
  await upsertModel('PaymentIntent', intent, { idempotencyKey: intent.idempotencyKey });
  return intent;
}

async function recordBookingFinancialDocuments(booking = {}, payment = null, actorId = 'finance-system') {
  ensureCollections();
  if (!booking || !booking.id || !booking.bookingRef) return null;
  const existingReceipt = store.state.receiptInvoices.find((item) => item.bookingRef === booking.bookingRef && item.documentType === 'receipt');
  const existingInvoice = store.state.receiptInvoices.find((item) => item.bookingRef === booking.bookingRef && item.documentType === 'invoice');
  const pricing = booking.pricing || {};
  const paymentRow = payment || store.state.payments.find((item) => item.bookingRef === booking.bookingRef || item.bookingId === booking.id) || {};
  const common = {
    bookingId: booking.id,
    bookingRef: booking.bookingRef,
    paymentId: paymentRow.id || booking.paymentRef || '',
    companyId: booking.companyId,
    customerUserId: booking.customerUserId || '',
    customerName: booking.guestSnapshot?.fullName || '',
    customerEmail: booking.guestSnapshot?.email || '',
    serviceType: booking.serviceType,
    subtotal: Number(pricing.subtotal || 0),
    fees: Number(pricing.fees || 0) + Number(pricing.addonTotal || 0),
    taxes: Number(pricing.taxes || 0),
    total: Number(pricing.total || paymentRow.amount || 0),
    currency: pricing.currency || paymentRow.currency || 'UGX',
    status: booking.paymentStatus === 'successful' ? 'issued' : 'pending',
    issuedAt: new Date().toISOString(),
    metadata: { paymentRef: paymentRow.providerReference || booking.paymentRef || '', ticketCount: (booking.ticketLegs || []).length || 1 },
  };
  const receipt = existingReceipt || { id: await atomicNextId('receipt-invoice'), documentRef: ref('RCT', store.state.receiptInvoices), documentType: 'receipt', ...common };
  Object.assign(receipt, common);
  if (!existingReceipt) store.state.receiptInvoices.unshift(receipt);
  const invoice = existingInvoice || { id: await atomicNextId('receipt-invoice'), documentRef: ref('INV', store.state.receiptInvoices), documentType: 'invoice', ...common };
  Object.assign(invoice, common);
  if (!existingInvoice) store.state.receiptInvoices.unshift(invoice);

  let taxRecord = store.state.taxFeeRecords.find((item) => item.bookingRef === booking.bookingRef);
  if (!taxRecord) {
    taxRecord = {
      id: await atomicNextId('tax-fee'),
      bookingId: booking.id,
      bookingRef: booking.bookingRef,
      paymentId: paymentRow.id || '',
      companyId: booking.companyId,
      currency: common.currency,
      subtotal: common.subtotal,
      serviceFee: Number(pricing.fees || 0),
      taxAmount: Number(pricing.taxes || 0),
      providerFee: Number(pricing.providerFee || 0),
      totalFees: Number(pricing.fees || 0) + Number(pricing.taxes || 0) + Number(pricing.providerFee || 0),
      status: 'recorded',
      recordedAt: new Date().toISOString(),
      metadata: { split: pricing.split || {} },
    };
    store.state.taxFeeRecords.unshift(taxRecord);
  }
  await upsertModel('ReceiptInvoice', receipt, { documentRef: receipt.documentRef });
  await upsertModel('ReceiptInvoice', invoice, { documentRef: invoice.documentRef });
  await upsertModel('TaxFeeRecord', taxRecord);
  audit(actorId, 'finance.documents.issued', booking.bookingRef, { receipt: receipt.documentRef, invoice: invoice.documentRef });
  return { receipt, invoice, taxRecord };
}

function riskFlagsForPayout(ownerType, ownerId, amount) {
  const flags = [];
  const pendingRefunds = (store.state.refundRequests || []).filter((item) => item.companyId === ownerId && !['rejected', 'closed'].includes(normalize(item.status))).length;
  const heldTxns = (store.state.walletTransactions || []).filter((txn) => txn.ownerType === ownerType && txn.ownerId === ownerId && ['held', 'review'].includes(normalize(txn.status))).length;
  if (pendingRefunds) flags.push('open_refunds');
  if (heldTxns) flags.push('held_wallet_transactions');
  if (Number(amount || 0) > 5000000) flags.push('large_payout');
  return flags;
}

async function createFinanceRiskReview(targetType, targetId, payload = {}, actorId = 'finance-system') {
  ensureCollections();
  const flags = riskFlagsForPayout(payload.ownerType, payload.ownerId, payload.amount);
  const riskScore = flags.length * 35;
  const review = {
    id: await atomicNextId('finance-risk'),
    targetType,
    targetId,
    ownerType: payload.ownerType || '',
    ownerId: payload.ownerId || '',
    amount: amountValue(payload.amount),
    currency: cleanText(payload.currency || 'UGX'),
    riskScore,
    flags,
    status: riskScore >= 70 ? 'hold_recommended' : 'clear',
    reviewedBy: actorId,
    reviewedAt: new Date().toISOString(),
    notes: flags.length ? flags.join(', ') : 'No finance risk flags detected',
    metadata: payload.metadata || {},
  };
  store.state.financeRiskReviews.unshift(review);
  await upsertModel('FinanceRiskReview', review);
  return review;
}

async function generateFinanceStatements(payload = {}, actorId = 'finance-system') {
  ensureCollections();
  const periodStart = payload.periodStart || null;
  const periodEnd = payload.periodEnd || new Date().toISOString();
  const rows = await financeRows(periodStart, periodEnd);
  const statements = [];
  for (const row of rows) {
    const wallet = await walletFor(row.ownerType, row.ownerId, row.currency);
    const statement = {
      id: await atomicNextId('finance-statement'),
      statementRef: ref('STMT', store.state.financeStatements),
      ownerType: row.ownerType,
      ownerId: row.ownerId,
      settlementBatchId: cleanText(payload.settlementBatchId || ''),
      payoutBatchId: cleanText(payload.payoutBatchId || ''),
      periodStart,
      periodEnd,
      currency: row.currency || wallet.currency || 'UGX',
      gross: Number(row.gross || 0),
      platformFee: Number(row.platformFee || 0),
      companyEarning: Number(row.companyEarning || 0),
      promoterCommission: Number(row.promoterCommission || 0),
      refundDebits: Number(row.refundDebits || 0),
      payoutTotal: (store.state.walletTransactions || []).filter((txn) => txn.ownerType === row.ownerType && txn.ownerId === row.ownerId && /withdraw|payout/.test(normalize(txn.transactionType || txn.referenceType))).reduce((total, txn) => total + Number(txn.amount || 0), 0),
      openingBalance: 0,
      closingBalance: Number(wallet.availableBalance || 0) + Number(wallet.pendingBalance || 0),
      status: 'issued',
      generatedBy: actorId,
      generatedAt: new Date().toISOString(),
      rows: [{ bookingRefs: row.bookingRefs || [], transactionIds: row.transactionIds || [] }],
      notes: cleanText(payload.notes || payload.note || ''),
    };
    store.state.financeStatements.unshift(statement);
    await upsertModel('FinanceStatement', statement, { statementRef: statement.statementRef });
    statements.push(statement);
  }
  audit(actorId, 'finance.statements.generated', 'finance-statements', { count: statements.length });
  return statements;
}

async function ensurePendingCommissionForBooking(booking) {
  if (!booking || !booking.id) return null;
  let commission = store.state.commissions.find((item) => item.bookingId === booking.id);
  if (!commission) {
    commission = commissionService.createCommission(booking, Boolean(booking.promoterAttribution), booking.pricing?.split);
    await upsertModel('Commission', commission);
  }
  return commission;
}

async function releaseEligibleEarnings(actorId = 'finance-system') {
  ensureCollections();
  const released = [];
  for (const booking of store.state.bookings.filter(bookingEligibleForRelease)) {
    const before = store.state.commissions.filter((item) => item.bookingId === booking.id && item.status === 'pending').length;
    await ensurePendingCommissionForBooking(booking);
    const result = (await releaseService.releaseCompletedBooking(booking.bookingRef)) || [];
    for (const commission of result) {
      commission.releaseSource = 'finance_settlement';
      commission.releasedBy = actorId;
      await upsertModel('Commission', commission);
      released.push({ bookingRef: booking.bookingRef, commissionId: commission.id, companyId: commission.companyId, promoterId: commission.promoterId, companyAmount: commission.companyAmount || 0, promoterAmount: commission.promoterAmount || 0 });
    }
    if (!result.length && before) await ensurePendingCommissionForBooking(booking);
  }
  audit(actorId, 'finance.earnings.released', 'eligible-bookings', { released: released.length });
  return released;
}

function bookingInPeriod(booking, periodStart, periodEnd) {
  const value = new Date(booking.checkedInAt || booking.completedAt || booking.createdAt || Date.now()).getTime();
  const start = periodStart ? new Date(periodStart).getTime() : 0;
  const end = periodEnd ? new Date(periodEnd).getTime() : Number.MAX_SAFE_INTEGER;
  return value >= start && value <= end;
}

async function walletFor(ownerType, ownerId, currency) {
  return walletService.getOrCreateWallet(ownerType, ownerId, currency);
}

// Rows are keyed by (owner, currency), not just owner: an owner who somehow has bookings in two
// different currencies (legacy data from before currency was locked to the company) gets two
// separate rows, each a real same-currency sum, instead of one row whose totals blindly mix
// amounts from both currencies under whichever currency label happened to be written last.
async function financeRows(periodStart, periodEnd) {
  const rowsByOwner = new Map();
  const add = (key, patch) => {
    const current = rowsByOwner.get(key) || { gross: 0, companyEarning: 0, promoterCommission: 0, platformFee: 0, refundDebits: 0, payable: 0, bookingRefs: [], transactionIds: [] };
    Object.assign(current, patch);
    rowsByOwner.set(key, current);
    return current;
  };

  for (const booking of store.state.bookings.filter((item) => bookingInPeriod(item, periodStart, periodEnd))) {
    const split = booking.pricing?.split || {};
    const currency = booking.pricing?.currency || 'UGX';
    const companyId = booking.companyId || 'company-unknown';
    const companyKey = `company:${companyId}:${currency}`;
    const company = add(companyKey, { ownerType: 'company', ownerId: companyId, currency });
    company.gross += Number(booking.pricing?.total || 0);
    company.companyEarning += Number(split.companyAmount || 0);
    company.platformFee += Number(split.platformFee || 0);
    company.payable += Number(split.companyAmount || 0);
    company.bookingRefs.push(booking.bookingRef);

    if (booking.promoterAttribution?.promoterId && Number(split.promoterAmount || 0) > 0) {
      const promoterKey = `promoter:${booking.promoterAttribution.promoterId}:${currency}`;
      const promoter = add(promoterKey, { ownerType: 'promoter', ownerId: booking.promoterAttribution.promoterId, currency });
      promoter.gross += Number(booking.pricing?.total || 0);
      promoter.promoterCommission += Number(split.promoterAmount || 0);
      promoter.payable += Number(split.promoterAmount || 0);
      promoter.bookingRefs.push(booking.bookingRef);
    }
  }

  for (const txn of store.state.walletTransactions.filter((item) => item.transactionType === 'refund_debit')) {
    const currency = txn.currency || 'UGX';
    const key = `${txn.ownerType}:${txn.ownerId}:${currency}`;
    const row = add(key, { ownerType: txn.ownerType, ownerId: txn.ownerId, currency });
    row.refundDebits += Number(txn.amount || 0);
    row.payable -= Number(txn.amount || 0);
    row.transactionIds.push(txn.id);
  }

  const rows = [];
  for (const row of rowsByOwner.values()) {
    const wallet = await walletFor(row.ownerType, row.ownerId, row.currency);
    const owner = row.ownerType === 'company' ? store.findCompany(row.ownerId) : store.state.users.find((user) => user.id === row.ownerId);
    rows.push({
      ...row,
      ownerName: owner?.name || owner?.fullName || row.ownerId,
      walletId: wallet.id,
      availableBalance: Number(wallet.availableBalance || 0),
      pendingBalance: Number(wallet.pendingBalance || 0),
      payoutAccount: owner?.payoutAccount || owner?.settings?.payoutAccount || owner?.phone || '',
      payable: Math.max(0, Math.min(Number(wallet.availableBalance || 0), row.payable || Number(wallet.availableBalance || 0))),
    });
  }
  return rows.filter((row) => row.gross > 0 || row.availableBalance > 0 || row.refundDebits > 0);
}

// One batch per currency, not one blended batch: summing rows across currencies into a single
// batch with one currency label was the exact "settlement mixing" bug - now each batch's totals
// are guaranteed to be a real same-currency sum.
async function createSettlementBatch(payload = {}, actorId = 'finance-system') {
  ensureCollections();
  const periodStart = payload.periodStart || null;
  const periodEnd = payload.periodEnd || new Date().toISOString();
  const rows = await financeRows(periodStart, periodEnd);
  const rowsByCurrency = new Map();
  rows.forEach((row) => {
    const currency = row.currency || 'UGX';
    if (!rowsByCurrency.has(currency)) rowsByCurrency.set(currency, []);
    rowsByCurrency.get(currency).push(row);
  });
  if (!rowsByCurrency.size) rowsByCurrency.set(cleanText(payload.currency || 'UGX'), []);

  const batches = [];
  for (const [currency, currencyRows] of rowsByCurrency) {
    const batch = {
      id: await atomicNextId('settlement'),
      batchNumber: `SET-${String(store.state.settlementBatches.length + 1).padStart(5, '0')}`,
      periodStart,
      periodEnd,
      currency,
      status: 'draft',
      createdBy: actorId,
      createdAt: new Date().toISOString(),
      totalGross: currencyRows.reduce((total, row) => total + Number(row.gross || 0), 0),
      totalCompanyEarning: currencyRows.reduce((total, row) => total + Number(row.companyEarning || 0), 0),
      totalPromoterCommission: currencyRows.reduce((total, row) => total + Number(row.promoterCommission || 0), 0),
      totalPlatformFee: currencyRows.reduce((total, row) => total + Number(row.platformFee || 0), 0),
      totalRefundDebits: currencyRows.reduce((total, row) => total + Number(row.refundDebits || 0), 0),
      totalPayable: currencyRows.reduce((total, row) => total + Number(row.payable || 0), 0),
      rows: currencyRows,
      notes: cleanText(payload.notes || payload.note || ''),
    };
    store.state.settlementBatches.unshift(batch);
    await upsertModel('SettlementBatch', batch);
    audit(actorId, 'finance.settlement.created', batch.id, { rows: currencyRows.length, totalPayable: batch.totalPayable, currency });
    batches.push(batch);
  }
  await generateFinanceStatements({ periodStart, periodEnd, settlementBatchId: batches[0]?.id || '', notes: cleanText(payload.notes || payload.note || '') }, actorId);
  return batches;
}

async function createPayoutRequestFromTransaction(transaction, payload = {}, actorId = 'finance-system') {
  ensureCollections();
  if (!transaction) return null;
  let request = store.state.payoutRequests.find((item) => item.transactionId === transaction.id);
  if (!request) {
    request = {
      id: await atomicNextId('payout-request'),
      ownerType: transaction.ownerType,
      ownerId: transaction.ownerId,
      walletId: transaction.walletId,
      transactionId: transaction.id,
      amount: Number(transaction.amount || 0),
      currency: transaction.currency || 'UGX',
      payoutMethod: cleanText(transaction.payoutMethod || payload.payoutMethod || payload.method || 'wallet'),
      payoutAccount: cleanText(transaction.payoutAccount || payload.payoutAccount || ''),
      status: 'requested',
      requestedBy: transaction.requestedBy || actorId,
      requestedAt: transaction.createdAt || new Date().toISOString(),
      notes: cleanText(transaction.note || payload.note || ''),
    };
    store.state.payoutRequests.unshift(request);
  } else {
    Object.assign(request, {
      amount: Number(transaction.amount || request.amount || 0),
      currency: transaction.currency || request.currency || 'UGX',
      payoutMethod: cleanText(transaction.payoutMethod || request.payoutMethod || 'wallet'),
      payoutAccount: cleanText(transaction.payoutAccount || request.payoutAccount || ''),
      status: request.status || 'requested',
      updatedAt: new Date().toISOString(),
    });
  }
  await upsertModel('PayoutRequest', request);
  return request;
}

async function syncPayoutRequests(actorId = 'finance-system') {
  ensureCollections();
  const payouts = store.state.walletTransactions.filter((txn) => /withdraw|payout/.test(normalize(txn.transactionType || txn.referenceType)));
  const requests = [];
  for (const txn of payouts) requests.push(await createPayoutRequestFromTransaction(txn, {}, actorId));
  return requests.filter(Boolean);
}

async function requestOwnerPayout(ownerType, ownerId, amount, payload = {}, actorId = 'dashboard-user') {
  ensureCollections();
  // An owner normally has exactly one wallet (their company's operating currency), so the
  // requested currency defaults to whichever wallet they already have; payload.currency lets a
  // promoter who has earned in more than one currency specify which balance to withdraw from.
  const existingWallet = store.state.wallets.find((w) => w.ownerType === ownerType && w.ownerId === ownerId);
  const currency = cleanText(payload.currency) || existingWallet?.currency || 'UGX';
  const wallet = await walletFor(ownerType, ownerId, currency);
  const result = await walletService.requestWithdrawal(ownerType, ownerId, currency, amountValue(amount, wallet.availableBalance), {
    referenceType: `${ownerType}_payout`,
    referenceId: ownerId,
    requestedBy: actorId,
  });
  if (result.transaction) {
    Object.assign(result.transaction, {
      payoutMethod: cleanText(payload.payoutMethod || payload.method || 'bank'),
      payoutAccount: cleanText(payload.payoutAccount || payload.account || ''),
      note: cleanText(payload.note || ''),
      requestedBy: actorId,
      updatedAt: new Date().toISOString(),
    });
    await upsertModel('WalletTransaction', result.transaction);
  }
  await upsertModel('Wallet', result.wallet);
  const request = await createPayoutRequestFromTransaction(result.transaction, payload, actorId);
  audit(actorId, `${ownerType}.payout.requested`, ownerId, { amount: amountValue(amount, wallet.availableBalance), transactionId: result.transaction?.id });
  return { ...result, request };
}

async function reviewPayoutRequest(transactionId, payload = {}, actorId = 'finance-system') {
  ensureCollections();
  const transaction = store.state.walletTransactions.find((txn) => txn.id === transactionId || txn.referenceId === transactionId);
  if (!transaction) {
    const error = new Error('Payout transaction not found');
    error.status = 404;
    throw error;
  }
  if (['completed', 'rejected'].includes(transaction.status)) {
    const error = new Error(`This payout was already ${transaction.status} and cannot be reviewed again.`);
    error.status = 409;
    throw error;
  }
  const action = normalize(payload.action || payload.status || 'approved');
  const request = await createPayoutRequestFromTransaction(transaction, payload, actorId);
  const riskReview = await createFinanceRiskReview('payout_request', request.id, { ownerType: request.ownerType, ownerId: request.ownerId, amount: request.amount, currency: request.currency }, actorId);
  request.riskReviewId = riskReview.id;
  request.riskStatus = riskReview.status;
  if (action === 'rejected') {
    const reason = cleanText(payload.reason || payload.note || 'Rejected by finance');
    await walletService.rejectWithdrawal(transaction.id, actorId, { reason });
    transaction.reviewReason = reason;
    request.status = 'rejected';
    request.rejectionReason = reason;
  } else if (action === 'held' || action === 'hold') {
    transaction.status = 'held';
    transaction.reviewedBy = actorId;
    transaction.reviewedAt = new Date().toISOString();
    transaction.holdReason = cleanText(payload.reason || payload.note || 'Held for review');
    request.status = 'held';
    request.holdReason = transaction.holdReason;
  } else {
    walletService.approveWithdrawal(transaction.id, actorId);
    transaction.providerReference = cleanText(payload.providerReference || payload.exportReference || `PAYOUT-${Date.now()}`);
    request.status = 'approved';
    request.providerReference = transaction.providerReference;
  }
  request.reviewedBy = actorId;
  request.reviewedAt = new Date().toISOString();
  request.notes = cleanText(payload.note || request.notes || '');
  await upsertModel('WalletTransaction', transaction);
  await upsertModel('PayoutRequest', request);
  audit(actorId, 'finance.payout.reviewed', transaction.id, { status: transaction.status, ownerType: transaction.ownerType, ownerId: transaction.ownerId });
  return { transaction, request };
}

async function createPayoutBatch(payload = {}, actorId = 'finance-system') {
  ensureCollections();
  await syncPayoutRequests(actorId);
  const selectedIds = String(payload.requestIds || payload.transactionIds || '').split(',').map(cleanText).filter(Boolean);
  let requests = store.state.payoutRequests.filter((request) => ['requested', 'approved'].includes(normalize(request.status)));
  if (selectedIds.length) requests = requests.filter((request) => selectedIds.includes(request.id) || selectedIds.includes(request.transactionId));
  if (!requests.length) {
    const error = new Error('No payout requests available for batch');
    error.status = 422;
    throw error;
  }
  // A payout batch must be one currency: requests in any other currency than the batch's own
  // are excluded rather than folded into a total that would mix units together.
  const batchCurrency = cleanText(payload.currency) || requests[0].currency || 'UGX';
  requests = requests.filter((request) => (request.currency || 'UGX') === batchCurrency);
  if (!requests.length) {
    const error = new Error(`No ${batchCurrency} payout requests available for batch`);
    error.status = 422;
    throw error;
  }
  const batch = {
    id: await atomicNextId('payout-batch'),
    batchNumber: `PO-${String(store.state.payoutBatches.length + 1).padStart(5, '0')}`,
    settlementBatchId: cleanText(payload.settlementBatchId || ''),
    currency: batchCurrency,
    ownerType: cleanText(payload.ownerType || 'mixed'),
    status: 'exported',
    createdBy: actorId,
    createdAt: new Date().toISOString(),
    exportedAt: new Date().toISOString(),
    providerReference: cleanText(payload.providerReference || `EXPORT-${Date.now()}`),
    totalAmount: requests.reduce((total, request) => total + Number(request.amount || 0), 0),
    requestIds: requests.map((request) => request.id),
    rows: requests.map((request) => ({ id: request.id, transactionId: request.transactionId, ownerType: request.ownerType, ownerId: request.ownerId, amount: request.amount, currency: request.currency, payoutMethod: request.payoutMethod, payoutAccount: request.payoutAccount, status: request.status })),
    notes: cleanText(payload.notes || payload.note || ''),
  };
  store.state.payoutBatches.unshift(batch);
  for (const request of requests) {
    request.payoutBatchId = batch.id;
    request.status = request.status === 'approved' ? 'batched' : 'exported';
    request.exportReference = batch.providerReference;
    request.updatedAt = new Date().toISOString();
    await upsertModel('PayoutRequest', request);
  }
  await upsertModel('PayoutBatch', batch);
  audit(actorId, 'finance.payout_batch.created', batch.id, { requests: requests.length, totalAmount: batch.totalAmount });
  return batch;
}

// Scoped to one currency at a time: reconciling gross payments against payouts only balances
// correctly when every figure summed into it is denominated in the same unit.
async function createReconciliationReport(payload = {}, actorId = 'finance-system') {
  ensureCollections();
  const periodStart = payload.periodStart || null;
  const periodEnd = payload.periodEnd || new Date().toISOString();
  const reportCurrency = cleanText(payload.currency) || 'UGX';
  const bookings = store.state.bookings.filter((booking) => bookingInPeriod(booking, periodStart, periodEnd) && (booking.pricing?.currency || 'UGX') === reportCurrency);
  const grossPayments = bookings.reduce((total, booking) => total + Number(booking.pricing?.total || 0), 0);
  const refundDebits = store.state.walletTransactions.filter((txn) => txn.transactionType === 'refund_debit' && (txn.currency || 'UGX') === reportCurrency).reduce((total, txn) => total + Number(txn.amount || 0), 0);
  const companyEarnings = bookings.reduce((total, booking) => total + Number(booking.pricing?.split?.companyAmount || 0), 0);
  const promoterCommissions = bookings.reduce((total, booking) => total + Number(booking.pricing?.split?.promoterAmount || 0), 0);
  const platformFees = bookings.reduce((total, booking) => total + Number(booking.pricing?.split?.platformFee || 0), 0);
  const requestedPayouts = store.state.payoutRequests.filter((request) => !['rejected', 'held'].includes(normalize(request.status)) && (request.currency || 'UGX') === reportCurrency).reduce((total, request) => total + Number(request.amount || 0), 0);
  const completedPayouts = store.state.walletTransactions.filter((txn) => /withdraw|payout/.test(normalize(txn.transactionType || txn.referenceType)) && ['completed', 'paid'].includes(normalize(txn.status)) && (txn.currency || 'UGX') === reportCurrency).reduce((total, txn) => total + Number(txn.amount || 0), 0);
  const variance = grossPayments - refundDebits - companyEarnings - promoterCommissions - platformFees;
  const report = {
    id: await atomicNextId('reconciliation'),
    settlementBatchId: cleanText(payload.settlementBatchId || ''),
    payoutBatchId: cleanText(payload.payoutBatchId || ''),
    periodStart,
    periodEnd,
    currency: reportCurrency,
    status: Math.abs(variance) <= 1 ? 'balanced' : 'variance_review',
    createdBy: actorId,
    createdAt: new Date().toISOString(),
    grossPayments,
    refundDebits,
    companyEarnings,
    promoterCommissions,
    platformFees,
    requestedPayouts,
    completedPayouts,
    variance,
    findings: [
      { label: 'Payment split variance', value: variance, status: Math.abs(variance) <= 1 ? 'ok' : 'review' },
      { label: 'Open payout exposure', value: Math.max(0, requestedPayouts - completedPayouts), status: requestedPayouts > completedPayouts ? 'open' : 'ok' },
    ],
    notes: cleanText(payload.notes || payload.note || ''),
  };
  store.state.reconciliationReports.unshift(report);
  await upsertModel('ReconciliationReport', report);
  audit(actorId, 'finance.reconciliation.created', report.id, { status: report.status, variance: report.variance });
  return report;
}

async function notifyPayoutResult(result) {
  const { transaction } = result || {};
  if (!transaction || transaction.status !== 'completed') return null;
  return notificationService.queueNotification({
    userId: transaction.ownerId,
    channels: ['email'],
    title: 'Payout approved',
    message: `Your payout of ${transaction.currency || 'UGX'} ${Number(transaction.amount || 0).toLocaleString()} has been approved.`,
    referenceType: 'payout',
    referenceId: transaction.id,
    meta: { ownerType: transaction.ownerType, ownerId: transaction.ownerId },
  });
}

module.exports = {
  recordPaymentIntent,
  recordBookingFinancialDocuments,
  createFinanceRiskReview,
  generateFinanceStatements,
  releaseEligibleEarnings,
  createSettlementBatch,
  syncPayoutRequests,
  requestOwnerPayout,
  reviewPayoutRequest,
  createPayoutBatch,
  createReconciliationReport,
  notifyPayoutResult,
};

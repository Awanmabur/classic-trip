const { platformCurrency } = require('../../utils/currency');
const financeRepository = require('../../repositories/domain/financeRepository');
const walletService = require('../wallet/walletService');
const ledgerService = require('../wallet/ledgerService');
const commissionService = require('../commission/commissionService');
const releaseService = require('../commission/releaseService');
const notificationService = require('../notification/notificationService');
const { nextId } = require('../data/idService');
const { env } = require('../../config/env');

function cleanText(value, max = 1000) {
  return String(value || '').replace(/<[^>]*>/g, '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function normalize(value) {
  return cleanText(value).toLowerCase().replace(/[\s-]+/g, '_');
}

function amountValue(value, fallback = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const amount = Number(String(value || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(amount) ? amount : fallback;
}

function bookingEligibleForRelease(booking = {}) {
  const serviceType = normalize(booking.serviceType);
  const bookingStatus = normalize(booking.bookingStatus || booking.checkInStatus);
  const stayStatus = normalize(booking.hotelStay?.status);
  if (serviceType === 'hotel') return bookingStatus === 'completed' && ['checked_out', 'completed'].includes(stayStatus);
  return ['checked_in', 'completed'].includes(bookingStatus);
}

function reference(prefix, id) {
  const suffix = String(id || Date.now()).split('-').pop().replace(/[^a-z0-9]/gi, '').toUpperCase();
  return `${prefix}-${suffix.padStart(6, '0')}`;
}

function normalizedPayoutMethod(value) {
  const method = normalize(value || 'wallet');
  if (method.includes('mobile')) return 'Mobile Money';
  if (method.includes('bank')) return 'Bank';
  return 'Wallet';
}

async function audit(actorId, action, target, meta = {}) {
  const row = {
    id: await nextId('audit'),
    actorId: actorId || 'finance-system',
    actorRole: 'finance_admin',
    action,
    target,
    entityType: 'finance',
    entityId: cleanText(target, 180),
    metadata: meta,
    status: 'success',
    createdAt: new Date().toISOString(),
  };
  await financeRepository.auditLogs.save(row, { id: row.id });
  return row;
}

async function recordPaymentIntent(payload = {}, actorId = 'payment-system') {
  const idempotencyKey = cleanText(payload.idempotencyKey || `${payload.provider || env.paymentProvider}:${payload.bookingRef || payload.cartRef || 'general'}:${payload.amount || 0}`, 240);
  let intent = await financeRepository.paymentIntents.findOne({ idempotencyKey });
  if (!intent) {
    const id = await nextId('payment-intent');
    intent = {
      id,
      intentRef: reference('PI', id),
      bookingId: cleanText(payload.bookingId, 180),
      bookingRef: cleanText(payload.bookingRef, 180),
      cartRef: cleanText(payload.cartRef, 180),
      companyId: cleanText(payload.companyId, 180),
      customerUserId: cleanText(payload.customerUserId, 180),
      provider: cleanText(payload.provider || env.paymentProvider, 40),
      providerReference: cleanText(payload.providerReference, 240),
      idempotencyKey,
      amount: amountValue(payload.amount),
      currency: cleanText(payload.currency || platformCurrency(), 8).toUpperCase(),
      status: cleanText(payload.status || 'created', 40),
      checkoutUrl: cleanText(payload.checkoutUrl, 1000),
      attempts: [],
      metadata: payload.metadata || {},
      createdBy: actorId,
      createdAt: new Date().toISOString(),
      expiresAt: payload.expiresAt || null,
    };
  }
  Object.assign(intent, {
    providerReference: cleanText(payload.providerReference || intent.providerReference, 240),
    status: cleanText(payload.status || intent.status || 'created', 40),
    checkoutUrl: cleanText(payload.checkoutUrl || intent.checkoutUrl, 1000),
    updatedAt: new Date().toISOString(),
  });
  intent.attempts = [...(intent.attempts || []), { status: intent.status, providerReference: intent.providerReference, at: intent.updatedAt }].slice(-25);
  if (intent.status === 'successful') intent.paidAt = intent.paidAt || new Date().toISOString();
  if (intent.status === 'failed') intent.failedAt = new Date().toISOString();
  await financeRepository.paymentIntents.save(intent, { idempotencyKey });
  return intent;
}

async function recordBookingFinancialDocuments(booking = {}, payment = null, actorId = 'finance-system') {
  if (!booking?.id || !booking?.bookingRef) return null;
  const [existingReceipt, existingInvoice, existingTaxRecord, paymentRow] = await Promise.all([
    financeRepository.receiptInvoices.findOne({ bookingRef: booking.bookingRef, documentType: 'receipt' }),
    financeRepository.receiptInvoices.findOne({ bookingRef: booking.bookingRef, documentType: 'invoice' }),
    financeRepository.taxFeeRecords.findOne({ bookingRef: booking.bookingRef }),
    payment ? Promise.resolve(payment) : financeRepository.payments.findOne({ $or: [{ bookingId: booking.id }, { bookingRef: booking.bookingRef }, { providerReference: booking.paymentRef }] }),
  ]);
  const pricing = booking.pricing || {};
  const common = {
    bookingId: booking.id,
    bookingRef: booking.bookingRef,
    paymentId: paymentRow?.id || booking.paymentRef || '',
    companyId: booking.companyId,
    customerUserId: booking.customerUserId || '',
    customerName: booking.guestSnapshot?.fullName || '',
    customerEmail: booking.guestSnapshot?.email || '',
    serviceType: booking.serviceType,
    subtotal: Number(pricing.subtotal || 0),
    fees: Number(pricing.fees || 0) + Number(pricing.addonTotal || 0),
    taxes: Number(pricing.taxes || 0),
    total: Number(pricing.total || paymentRow?.amount || 0),
    currency: String(pricing.currency || paymentRow?.currency || platformCurrency()).toUpperCase(),
    status: 'issued',
    issuedAt: new Date().toISOString(),
    metadata: { paymentRef: paymentRow?.providerReference || booking.paymentRef || '', ticketCount: (booking.ticketLegs || []).length || 1 },
  };
  const receiptId = existingReceipt?.id || await nextId('receipt-invoice');
  const receipt = { ...(existingReceipt || {}), id: receiptId, documentRef: existingReceipt?.documentRef || reference('RCT', receiptId), documentType: 'receipt', ...common };
  const invoiceId = existingInvoice?.id || await nextId('receipt-invoice');
  const invoice = { ...(existingInvoice || {}), id: invoiceId, documentRef: existingInvoice?.documentRef || reference('INV', invoiceId), documentType: 'invoice', ...common };
  const taxRecord = existingTaxRecord || {
    id: await nextId('tax-fee'),
    bookingId: booking.id,
    bookingRef: booking.bookingRef,
    paymentId: paymentRow?.id || '',
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
  await financeRepository.withTransaction(async (session) => {
    await financeRepository.receiptInvoices.save(receipt, { documentRef: receipt.documentRef }, { session });
    await financeRepository.receiptInvoices.save(invoice, { documentRef: invoice.documentRef }, { session });
    await financeRepository.taxFeeRecords.save(taxRecord, { bookingRef: booking.bookingRef }, { session });
  });
  await audit(actorId, 'finance.documents.issued', booking.bookingRef, { receipt: receipt.documentRef, invoice: invoice.documentRef });
  return { receipt, invoice, taxRecord };
}

async function riskFlagsForPayout(ownerType, ownerId, amount) {
  const [pendingRefunds, heldTransactions] = await Promise.all([
    ownerType === 'company' ? financeRepository.refunds.count({ companyId: ownerId, status: { $nin: ['rejected', 'closed'] } }) : 0,
    financeRepository.transactions.count({ ownerType, ownerId, status: { $in: ['held', 'review'] } }),
  ]);
  const flags = [];
  if (pendingRefunds) flags.push('open_refunds');
  if (heldTransactions) flags.push('held_wallet_transactions');
  if (Number(amount || 0) > 5000000) flags.push('large_payout');
  return flags;
}

async function createFinanceRiskReview(targetType, targetId, payload = {}, actorId = 'finance-system') {
  const flags = await riskFlagsForPayout(payload.ownerType, payload.ownerId, payload.amount);
  const riskScore = flags.length * 35;
  const review = {
    id: await nextId('finance-risk'),
    targetType,
    targetId,
    ownerType: payload.ownerType || '',
    ownerId: payload.ownerId || '',
    amount: amountValue(payload.amount),
    currency: cleanText(payload.currency || platformCurrency(), 8).toUpperCase(),
    riskScore,
    flags,
    status: riskScore >= 70 ? 'hold_recommended' : 'clear',
    reviewedBy: actorId,
    reviewedAt: new Date().toISOString(),
    notes: flags.length ? flags.join(', ') : 'No finance risk flags detected',
    metadata: payload.metadata || {},
  };
  await financeRepository.riskReviews.save(review, { id: review.id });
  return review;
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

async function financeRows(periodStart, periodEnd) {
  const [bookings, transactions, commissions] = await Promise.all([
    financeRepository.bookings.list({}, { sort: { createdAt: -1 }, limit: 5000 }),
    financeRepository.transactions.list({}, { sort: { createdAt: -1 }, limit: 10000 }),
    financeRepository.commissions.list({}, { sort: { createdAt: -1 }, limit: 10000 }),
  ]);
  const rowsByOwner = new Map();
  const add = (key, patch) => {
    const current = rowsByOwner.get(key) || { gross: 0, companyEarning: 0, promoterCommission: 0, platformFee: 0, refundDebits: 0, payable: 0, bookingRefs: [], transactionIds: [] };
    Object.assign(current, patch);
    rowsByOwner.set(key, current);
    return current;
  };
  for (const booking of bookings.filter((item) => bookingInPeriod(item, periodStart, periodEnd))) {
    const split = booking.pricing?.split || {};
    const currency = String(booking.pricing?.currency || platformCurrency()).toUpperCase();
    const companyId = booking.companyId || 'company-unknown';
    const company = add(`company:${companyId}:${currency}`, { ownerType: 'company', ownerId: companyId, currency });
    company.gross += Number(booking.pricing?.total || 0);
    company.companyEarning += Number(split.companyAmount || 0);
    company.platformFee += Number(split.platformFee || 0);
    company.payable += Number(split.companyAmount || 0);
    company.bookingRefs.push(booking.bookingRef);
    if (booking.promoterAttribution?.promoterId && Number(split.promoterAmount || 0) > 0) {
      const promoterId = booking.promoterAttribution.promoterId;
      const promoter = add(`promoter:${promoterId}:${currency}`, { ownerType: 'promoter', ownerId: promoterId, currency });
      promoter.gross += Number(booking.pricing?.total || 0);
      promoter.promoterCommission += Number(split.promoterAmount || 0);
      promoter.payable += Number(split.promoterAmount || 0);
      promoter.bookingRefs.push(booking.bookingRef);
    }
  }
  const bookingById = new Map(bookings.map((booking) => [String(booking.id), booking]));
  for (const commission of commissions) {
    const booking = bookingById.get(String(commission.bookingId));
    if (booking && !bookingInPeriod(booking, periodStart, periodEnd)) continue;
    const currency = String(booking?.pricing?.currency || commission.currency || platformCurrency()).toUpperCase();
    const companyId = commission.companyId || booking?.companyId || 'company-unknown';
    const company = add(`company:${companyId}:${currency}`, { ownerType: 'company', ownerId: companyId, currency });
    const split = booking?.pricing?.split || {};
    if (!Number(split.companyAmount || 0)) company.companyEarning += Number(commission.companyAmount || 0);
    if (!Number(split.platformFee || 0)) company.platformFee += Number(commission.platformFee || 0);
    company.payable = Math.max(company.payable, Number(commission.companyAmount || 0));
    if (commission.bookingRef && !company.bookingRefs.includes(commission.bookingRef)) company.bookingRefs.push(commission.bookingRef);
    if (commission.promoterId && Number(commission.promoterAmount || 0) > 0) {
      const promoter = add(`promoter:${commission.promoterId}:${currency}`, { ownerType: 'promoter', ownerId: commission.promoterId, currency });
      if (!Number(split.promoterAmount || 0)) promoter.promoterCommission += Number(commission.promoterAmount || 0);
      promoter.payable = Math.max(promoter.payable, Number(commission.promoterAmount || 0));
      if (commission.bookingRef && !promoter.bookingRefs.includes(commission.bookingRef)) promoter.bookingRefs.push(commission.bookingRef);
    }
  }
  for (const txn of transactions.filter((item) => item.transactionType === 'refund_debit')) {
    const currency = String(txn.currency || platformCurrency()).toUpperCase();
    const row = add(`${txn.ownerType}:${txn.ownerId}:${currency}`, { ownerType: txn.ownerType, ownerId: txn.ownerId, currency });
    row.refundDebits += Number(txn.amount || 0);
    row.payable -= Number(txn.amount || 0);
    row.transactionIds.push(txn.id);
  }
  const rows = [];
  for (const row of rowsByOwner.values()) {
    const [wallet, owner] = await Promise.all([
      walletFor(row.ownerType, row.ownerId, row.currency),
      row.ownerType === 'company' ? financeRepository.companies.findOne({ id: row.ownerId }) : financeRepository.users.findOne({ id: row.ownerId }),
    ]);
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

async function generateFinanceStatements(payload = {}, actorId = 'finance-system') {
  const periodStart = payload.periodStart || null;
  const periodEnd = payload.periodEnd || new Date().toISOString();
  const [rows, transactions] = await Promise.all([
    financeRows(periodStart, periodEnd),
    financeRepository.transactions.list({}, { sort: { createdAt: -1 }, limit: 10000 }),
  ]);
  const statements = [];
  for (const row of rows) {
    const wallet = await walletFor(row.ownerType, row.ownerId, row.currency);
    const id = await nextId('finance-statement');
    const statement = {
      id,
      statementRef: reference('STMT', id),
      ownerType: row.ownerType,
      ownerId: row.ownerId,
      settlementBatchId: cleanText(payload.settlementBatchId, 180),
      payoutBatchId: cleanText(payload.payoutBatchId, 180),
      periodStart,
      periodEnd,
      currency: row.currency || wallet.currency || platformCurrency(),
      gross: Number(row.gross || 0),
      platformFee: Number(row.platformFee || 0),
      companyEarning: Number(row.companyEarning || 0),
      promoterCommission: Number(row.promoterCommission || 0),
      refundDebits: Number(row.refundDebits || 0),
      payoutTotal: transactions.filter((txn) => txn.ownerType === row.ownerType && txn.ownerId === row.ownerId && /withdraw|payout/.test(normalize(txn.transactionType || txn.referenceType))).reduce((total, txn) => total + Number(txn.amount || 0), 0),
      openingBalance: 0,
      closingBalance: Number(wallet.availableBalance || 0) + Number(wallet.pendingBalance || 0),
      status: 'issued',
      generatedBy: actorId,
      generatedAt: new Date().toISOString(),
      rows: [{ bookingRefs: row.bookingRefs || [], transactionIds: row.transactionIds || [] }],
      notes: cleanText(payload.notes || payload.note),
    };
    await financeRepository.statements.save(statement, { statementRef: statement.statementRef });
    statements.push(statement);
  }
  await audit(actorId, 'finance.statements.generated', 'finance-statements', { count: statements.length });
  return statements;
}

async function ensurePendingCommissionForBooking(booking) {
  if (!booking?.id) return null;
  let commission = await financeRepository.commissions.findOne({ bookingId: booking.id });
  if (!commission) commission = await commissionService.createCommission(booking, Boolean(booking.promoterAttribution), booking.pricing?.split);
  return commission;
}

async function releaseEligibleEarnings(actorId = 'finance-system') {
  const bookings = await financeRepository.bookings.list({}, { sort: { createdAt: -1 }, limit: 5000 });
  const released = [];
  for (const booking of bookings.filter(bookingEligibleForRelease)) {
    await ensurePendingCommissionForBooking(booking);
    const result = (await releaseService.releaseCompletedBooking(booking.bookingRef)) || [];
    for (const commission of result) {
      Object.assign(commission, { releaseSource: 'finance_settlement', releasedBy: actorId });
      await financeRepository.commissions.save(commission, { id: commission.id });
      released.push({ bookingRef: booking.bookingRef, commissionId: commission.id, companyId: commission.companyId, promoterId: commission.promoterId, companyAmount: commission.companyAmount || 0, promoterAmount: commission.promoterAmount || 0 });
    }
  }
  await audit(actorId, 'finance.earnings.released', 'eligible-bookings', { released: released.length });
  return released;
}

async function createSettlementBatch(payload = {}, actorId = 'finance-system') {
  const periodStart = payload.periodStart || null;
  const periodEnd = payload.periodEnd || new Date().toISOString();
  const rows = await financeRows(periodStart, periodEnd);
  const rowsByCurrency = new Map();
  rows.forEach((row) => {
    const currency = row.currency || platformCurrency();
    if (!rowsByCurrency.has(currency)) rowsByCurrency.set(currency, []);
    rowsByCurrency.get(currency).push(row);
  });
  if (!rowsByCurrency.size) rowsByCurrency.set(cleanText(payload.currency || platformCurrency(), 8).toUpperCase(), []);
  const batches = [];
  for (const [currency, currencyRows] of rowsByCurrency) {
    const id = await nextId('settlement');
    const batch = {
      id,
      batchNumber: reference('SET', id),
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
      notes: cleanText(payload.notes || payload.note),
    };
    await financeRepository.settlementBatches.save(batch, { batchNumber: batch.batchNumber });
    await audit(actorId, 'finance.settlement.created', batch.id, { rows: currencyRows.length, totalPayable: batch.totalPayable, currency });
    batches.push(batch);
  }
  await generateFinanceStatements({ periodStart, periodEnd, settlementBatchId: batches[0]?.id || '', notes: cleanText(payload.notes || payload.note) }, actorId);
  return batches;
}

async function createPayoutRequestFromTransaction(transaction, payload = {}, actorId = 'finance-system') {
  if (!transaction) return null;
  let request = await financeRepository.payoutRequests.findOne({ transactionId: transaction.id });
  if (!request) {
    request = {
      id: await nextId('payout-request'),
      ownerType: transaction.ownerType,
      ownerId: transaction.ownerId,
      walletId: transaction.walletId,
      transactionId: transaction.id,
      amount: Number(transaction.amount || 0),
      currency: String(transaction.currency || platformCurrency()).toUpperCase(),
      payoutMethod: normalizedPayoutMethod(transaction.payoutMethod || payload.payoutMethod || payload.method),
      payoutAccount: cleanText(transaction.payoutAccount || payload.payoutAccount, 240),
      status: 'requested',
      requestedBy: transaction.requestedBy || actorId,
      requestedAt: transaction.createdAt || new Date().toISOString(),
      notes: cleanText(transaction.note || payload.note),
    };
  } else {
    Object.assign(request, {
      amount: Number(transaction.amount || request.amount || 0),
      currency: String(transaction.currency || request.currency || platformCurrency()).toUpperCase(),
      payoutMethod: normalizedPayoutMethod(transaction.payoutMethod || request.payoutMethod),
      payoutAccount: cleanText(transaction.payoutAccount || request.payoutAccount, 240),
      updatedAt: new Date().toISOString(),
    });
  }
  await financeRepository.payoutRequests.save(request, { transactionId: transaction.id });
  return request;
}

async function syncPayoutRequests(actorId = 'finance-system') {
  const payouts = await financeRepository.transactions.list({ transactionType: 'withdrawal_request' }, { sort: { createdAt: -1 }, limit: 5000 });
  const requests = [];
  for (const txn of payouts) requests.push(await createPayoutRequestFromTransaction(txn, {}, actorId));
  return requests.filter(Boolean);
}

async function requestOwnerPayout(ownerType, ownerId, amount, payload = {}, actorId = 'dashboard-user') {
  if (!['company', 'promoter'].includes(ownerType)) {
    const error = new Error('Payouts are available only for companies and promoters');
    error.status = 422;
    throw error;
  }
  if (ownerType === 'promoter') {
    const promoter = await financeRepository.users.findOne({ id: ownerId, role: 'promoter' });
    if (!promoter || normalize(promoter.status) !== 'active' || normalize(promoter.verificationStatus) !== 'verified') {
      const error = new Error('Promoter verification must be approved before requesting payouts');
      error.status = 403;
      throw error;
    }
  }
  if (ownerType === 'company') {
    const company = await financeRepository.companies.findOne({ id: ownerId });
    if (!company || normalize(company.status) !== 'active' || normalize(company.verificationStatus) !== 'verified') {
      const error = new Error('Company verification must be approved before requesting payouts');
      error.status = 403;
      throw error;
    }
  }
  const wallets = await financeRepository.wallets.list({ ownerType, ownerId });
  const currency = cleanText(payload.currency || wallets[0]?.currency || platformCurrency(), 8).toUpperCase();
  const wallet = await walletFor(ownerType, ownerId, currency);
  const requestedAmount = amountValue(amount, wallet.availableBalance);
  if (requestedAmount <= 0) {
    const error = new Error('Payout amount must be greater than zero');
    error.status = 422;
    throw error;
  }
  const result = await walletService.requestWithdrawal(ownerType, ownerId, currency, requestedAmount, {
    referenceType: 'payout',
    referenceId: ownerId,
    payoutMethod: normalizedPayoutMethod(payload.payoutMethod || payload.method),
    payoutAccount: cleanText(payload.payoutAccount || payload.account, 240),
    meta: { requestedBy: actorId, note: cleanText(payload.note) },
  });
  if (result.transaction) {
    Object.assign(result.transaction, {
      payoutMethod: normalizedPayoutMethod(payload.payoutMethod || payload.method),
      payoutAccount: cleanText(payload.payoutAccount || payload.account, 240),
      note: cleanText(payload.note),
      requestedBy: actorId,
      updatedAt: new Date().toISOString(),
    });
    await financeRepository.transactions.save(result.transaction, { id: result.transaction.id });
  }
  const request = await createPayoutRequestFromTransaction(result.transaction, payload, actorId);
  await audit(actorId, `${ownerType}.payout.requested`, ownerId, { amount: requestedAmount, transactionId: result.transaction?.id });
  return { ...result, request };
}

async function reviewPayoutRequest(transactionId, payload = {}, actorId = 'finance-system') {
  const transaction = await financeRepository.transactions.findOne({ $or: [{ id: transactionId }, { referenceId: transactionId }] });
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
    const rejected = await walletService.rejectWithdrawal(transaction.id, actorId, { reason });
    Object.assign(transaction, rejected || {}, { reviewReason: reason });
    Object.assign(request, { status: 'rejected', rejectionReason: reason });
  } else if (action === 'held' || action === 'hold') {
    Object.assign(transaction, { status: 'held', reviewedBy: actorId, reviewedAt: new Date().toISOString(), holdReason: cleanText(payload.reason || payload.note || 'Held for review') });
    Object.assign(request, { status: 'held', holdReason: transaction.holdReason });
  } else {
    const approved = await walletService.approveWithdrawalPersisted(transaction.id, actorId);
    Object.assign(transaction, approved || {}, { providerReference: cleanText(payload.providerReference || payload.exportReference || `PAYOUT-${Date.now()}`, 240) });
    Object.assign(request, { status: 'approved', providerReference: transaction.providerReference });
  }
  Object.assign(request, { reviewedBy: actorId, reviewedAt: new Date().toISOString(), notes: cleanText(payload.note || request.notes) });
  await financeRepository.withTransaction(async (session) => {
    await financeRepository.transactions.save(transaction, { id: transaction.id }, { session });
    await financeRepository.payoutRequests.save(request, { transactionId: transaction.id }, { session });
  });
  await audit(actorId, 'finance.payout.reviewed', transaction.id, { status: transaction.status, ownerType: transaction.ownerType, ownerId: transaction.ownerId });
  return { transaction, request };
}

async function createPayoutBatch(payload = {}, actorId = 'finance-system') {
  await syncPayoutRequests(actorId);
  const selectedIds = String(payload.requestIds || payload.transactionIds || '').split(',').map((value) => cleanText(value, 180)).filter(Boolean);
  let requests = await financeRepository.payoutRequests.list({ status: { $in: ['requested', 'approved'] } }, { sort: { requestedAt: 1 }, limit: 5000 });
  if (selectedIds.length) requests = requests.filter((request) => selectedIds.includes(request.id) || selectedIds.includes(request.transactionId));
  if (!requests.length) {
    const error = new Error('No payout requests available for batch');
    error.status = 422;
    throw error;
  }
  const batchCurrency = cleanText(payload.currency || requests[0].currency || platformCurrency(), 8).toUpperCase();
  requests = requests.filter((request) => String(request.currency || platformCurrency()).toUpperCase() === batchCurrency);
  if (!requests.length) {
    const error = new Error(`No ${batchCurrency} payout requests available for batch`);
    error.status = 422;
    throw error;
  }
  const id = await nextId('payout-batch');
  const batch = {
    id,
    batchNumber: reference('PO', id),
    settlementBatchId: cleanText(payload.settlementBatchId, 180),
    currency: batchCurrency,
    ownerType: cleanText(payload.ownerType || 'mixed', 40),
    status: 'exported',
    createdBy: actorId,
    createdAt: new Date().toISOString(),
    exportedAt: new Date().toISOString(),
    providerReference: cleanText(payload.providerReference || `EXPORT-${Date.now()}`, 240),
    totalAmount: requests.reduce((total, request) => total + Number(request.amount || 0), 0),
    requestIds: requests.map((request) => request.id),
    rows: requests.map((request) => ({ id: request.id, transactionId: request.transactionId, ownerType: request.ownerType, ownerId: request.ownerId, amount: request.amount, currency: request.currency, payoutMethod: request.payoutMethod, payoutAccount: request.payoutAccount, status: request.status })),
    notes: cleanText(payload.notes || payload.note),
  };
  await financeRepository.withTransaction(async (session) => {
    await financeRepository.payoutBatches.save(batch, { batchNumber: batch.batchNumber }, { session });
    for (const request of requests) {
      Object.assign(request, { payoutBatchId: batch.id, exportReference: batch.providerReference, updatedAt: new Date().toISOString() });
      await financeRepository.payoutRequests.save(request, { transactionId: request.transactionId }, { session });
    }
  });
  await audit(actorId, 'finance.payout_batch.created', batch.id, { requests: requests.length, totalAmount: batch.totalAmount });
  return batch;
}

async function createReconciliationReport(payload = {}, actorId = 'finance-system') {
  const periodStart = payload.periodStart || null;
  const periodEnd = payload.periodEnd || new Date().toISOString();
  const reportCurrency = cleanText(payload.currency || platformCurrency(), 8).toUpperCase();
  const [allBookings, transactions, payoutRequests] = await Promise.all([
    financeRepository.bookings.list({}, { sort: { createdAt: -1 }, limit: 10000 }),
    financeRepository.transactions.list({}, { sort: { createdAt: -1 }, limit: 20000 }),
    financeRepository.payoutRequests.list({}, { sort: { requestedAt: -1 }, limit: 10000 }),
  ]);
  const bookings = allBookings.filter((booking) => bookingInPeriod(booking, periodStart, periodEnd) && String(booking.pricing?.currency || platformCurrency()).toUpperCase() === reportCurrency);
  const grossPayments = bookings.reduce((total, booking) => total + Number(booking.pricing?.total || 0), 0);
  const refundDebits = transactions.filter((txn) => txn.transactionType === 'refund_debit' && String(txn.currency || platformCurrency()).toUpperCase() === reportCurrency).reduce((total, txn) => total + Number(txn.amount || 0), 0);
  const companyEarnings = bookings.reduce((total, booking) => total + Number(booking.pricing?.split?.companyAmount || 0), 0);
  const promoterCommissions = bookings.reduce((total, booking) => total + Number(booking.pricing?.split?.promoterAmount || 0), 0);
  const platformFees = bookings.reduce((total, booking) => total + Number(booking.pricing?.split?.platformFee || 0), 0);
  const requestedPayouts = payoutRequests.filter((request) => !['rejected', 'held'].includes(normalize(request.status)) && String(request.currency || platformCurrency()).toUpperCase() === reportCurrency).reduce((total, request) => total + Number(request.amount || 0), 0);
  const completedPayouts = transactions.filter((txn) => txn.transactionType === 'withdrawal_request' && ['completed', 'paid'].includes(normalize(txn.status)) && String(txn.currency || platformCurrency()).toUpperCase() === reportCurrency).reduce((total, txn) => total + Number(txn.amount || 0), 0);
  const variance = grossPayments - refundDebits - companyEarnings - promoterCommissions - platformFees;
  const report = {
    id: await nextId('reconciliation'),
    settlementBatchId: cleanText(payload.settlementBatchId, 180),
    payoutBatchId: cleanText(payload.payoutBatchId, 180),
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
    notes: cleanText(payload.notes || payload.note),
  };
  await financeRepository.reconciliationReports.save(report, { id: report.id });
  await audit(actorId, 'finance.reconciliation.created', report.id, { status: report.status, variance: report.variance });
  return report;
}

async function notifyPayoutResult(result) {
  const { transaction } = result || {};
  if (!transaction || transaction.status !== 'completed') return null;
  return notificationService.queueNotification({
    userId: transaction.ownerId,
    channels: ['email'],
    title: 'Payout approved',
    message: `Your payout of ${transaction.currency || platformCurrency()} ${Number(transaction.amount || 0).toLocaleString()} has been approved.`,
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
  financeRows,
};

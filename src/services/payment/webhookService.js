const { platformCurrency } = require('../../utils/currency');
const crypto = require('crypto');
const commerceRepository = require('../../repositories/domain/commerceRepository');
const hotelRepository = require('../../repositories/domain/hotelRepository');
const paymentSettlementService = require('../booking/paymentSettlementService');
const { nextId } = require('../data/idService');
const notificationService = require('../notification/notificationService');
const securityService = require('../security/securityService');
const paymentService = require('./paymentService');
const busBookingService = require('../../modules/bus/services/busBookingService');
const flightBookingService = require('../../modules/flight/services/flightBookingService');
const taxiRideService = require('../../modules/taxi/services/taxiRideService');
const { env } = require('../../config/env');
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function signPayload(payload, secret = env.paymentWebhookSecret) {
  return crypto.createHmac('sha256', secret).update(stableStringify(payload)).digest('hex');
}

function cleanSignature(value = '') {
  return String(value || '').replace(/^sha256=/, '').trim();
}

function signaturesMatch(expected, provided) {
  const left = Buffer.from(cleanSignature(expected));
  const right = Buffer.from(cleanSignature(provided));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}


function rawBodyHash(headers = {}) {
  const body = headers.__rawBody || '';
  return body ? crypto.createHash('sha256').update(body).digest('hex') : '';
}

async function persistWebhookEvent(payload = {}, headers = {}, patch = {}) {
  const idempotencyKey = payload.idempotencyKey || payload.eventId || `${payload.provider || 'provider'}:${payload.providerReference || payload.reference || payload.bookingRef || Date.now()}`;
  const provider = payload.provider || env.paymentProvider;
  const existing = await commerceRepository.webhookEvents.findOne({ provider, idempotencyKey });
  const terminal = existing && ['processed', 'blocked'].includes(existing.status);
  const wouldRegress = terminal && (!patch.status || patch.status === 'received');
  const row = {
    ...(existing || {}),
    id: `webhook-${crypto.createHash('sha1').update(`${payload.provider || ''}:${idempotencyKey}`).digest('hex').slice(0, 16)}`,
    provider, providerReference: payload.providerReference || payload.reference || existing?.providerReference || '',
    bookingRef: payload.bookingRef || payload.reference || payload.meta?.bookingRef || '', idempotencyKey,
    status: wouldRegress ? existing.status : (patch.status || existing?.status || 'received'),
    signatureStatus: wouldRegress ? existing.signatureStatus : (patch.signatureStatus || existing?.signatureStatus || 'unchecked'),
    amount: Number(payload.amount || existing?.amount || 0), currency: payload.currency || existing?.currency || platformCurrency(),
    eventType: payload.event || payload.type || payload.status || existing?.eventType || '', rawPayload: payload.originalPayload || payload,
    rawBodyHash: rawBodyHash(headers) || existing?.rawBodyHash || '',
    deliveryCount: Number(existing?.deliveryCount || 0) + (patch.status === 'received' ? 1 : 0),
    lastReceivedAt: new Date(),
    ...(wouldRegress ? {} : patch),
  };
  await commerceRepository.webhookEvents.save(row, { provider: row.provider, idempotencyKey: row.idempotencyKey });
  return row;
}

function assertValidSignature(payload, headers = {}) {
  const providerName = payload.provider || env.paymentProvider;
  const providerConfig = env.paymentProviders[providerName] || {};
  const providerSignature = require('./httpPaymentProvider').signatureForProvider(providerName, payload, providerConfig, headers);
  if (providerSignature.configured) {
    if (providerSignature.valid) return true;
    const error = new Error(providerSignature.reason || 'Invalid provider payment webhook signature');
    error.status = 401;
    throw error;
  }

  const provided = headers['x-classic-trip-signature'] || headers['x-payment-signature'] || headers['X-Classic-Trip-Signature'];
  if (!provided) {
    const error = new Error('Missing payment webhook signature');
    error.status = 401;
    throw error;
  }
  const expected = signPayload(payload);
  const originalExpected = payload && payload.originalPayload ? signPayload(payload.originalPayload) : '';
  if (!signaturesMatch(expected, provided) && (!originalExpected || !signaturesMatch(originalExpected, provided))) {
    const error = new Error(providerSignature.configured ? providerSignature.reason : 'Invalid payment webhook signature');
    error.status = 401;
    throw error;
  }
  return true;
}


function pickFirst(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function refundLifecycleStatus(eventName = '', status = '') {
  const event = String(eventName || '').toLowerCase().replace(/[_\s]+/g, '-');
  if (!event.includes('refund')) return '';
  const value = String(status || '').toLowerCase().replace(/[_\s]+/g, '-');
  const combined = `${event}:${value}`;
  if (/(needs-attention|needs_attention)/.test(combined)) return 'needs_attention';
  if (/(failed|declined|rejected|cancelled|canceled)/.test(combined)) return 'failed';
  if (/(processed|completed|successful|succeeded|success|refunded|reversed)/.test(combined)) return 'completed';
  if (/(pending|processing|queued|created)/.test(combined)) return 'processing';
  return 'processing';
}

function webhookAmount(provider, amount, currency) {
  const numeric = Number(amount ?? 0);
  if (String(provider || '').toLowerCase() !== 'paystack') return numeric;
  return numeric / 100;
}

function normalizeProviderPayload(payload = {}) {
  const legacyRefundShape = Boolean(payload.AmountRefunded || payload.amount_refunded || payload.TransactionId);
  const data = payload.data && typeof payload.data === 'object'
    ? payload.data
    : (legacyRefundShape ? payload : (payload.transaction && typeof payload.transaction === 'object' ? payload.transaction : {}));
  const transaction = data.transaction && typeof data.transaction === 'object' ? data.transaction : {};
  const meta = payload.meta || payload.metadata || data.meta || data.metadata || data.customer || {};
  const hasPesapalShape = Boolean(payload.OrderTrackingId || payload.order_tracking_id || payload.orderTrackingId || data.OrderTrackingId || data.order_tracking_id || payload.OrderMerchantReference || payload.order_merchant_reference || payload.merchant_reference);
  const provider = pickFirst(payload.provider, data.provider, payload.source, hasPesapalShape ? 'pesapal' : env.paymentProvider);
  const rawAmount = pickFirst(payload.amount, payload.payment_amount, payload.AmountRefunded, payload.amount_refunded, data.amount, data.amount_refunded, data.AmountRefunded, data.payment_amount, data.charged_amount, data.requested_amount, meta.amount);
  const rawCurrency = pickFirst(payload.currency, payload.currency_code, data.currency, data.currency_code, meta.currency);
  const eventName = typeof payload.event === 'string' ? payload.event : pickFirst(payload.type, payload.event_type, data.event, data.type, legacyRefundShape ? 'refund.completed' : '');
  const lifecycle = refundLifecycleStatus(eventName, pickFirst(data.status, payload.status));
  const originalPaymentReference = lifecycle
    ? pickFirst(payload.providerReference, data.transaction_reference, data.transactionReference, transaction.reference, transaction.providerReference, data.original_transaction_reference, data.originalTransactionReference, data.charge_id, data.chargeId, data.TransactionId, data.transaction_id, data.tx_id, data.flw_ref, data.FlwRef, data.tx_ref, payload.OrderTrackingId, payload.order_tracking_id)
    : pickFirst(payload.providerReference, payload.OrderTrackingId, payload.order_tracking_id, payload.orderTrackingId, payload.transaction_id, payload.flw_ref, payload.reference, payload.tx_ref, data.providerReference, data.OrderTrackingId, data.order_tracking_id, data.orderTrackingId, data.id, data.reference, data.flw_ref, data.tx_ref);
  const providerRefundReference = lifecycle
    ? pickFirst(payload.providerRefundReference, payload.refund_reference, data.refund_reference, data.refundReference, data.refund_id, data.refundId, data.id)
    : '';
  const normalizedCurrency = String(rawCurrency || platformCurrency()).toUpperCase();
  return {
    ...payload,
    provider,
    event: eventName || payload.event,
    bookingRef: pickFirst(payload.bookingRef, payload.orderRef, payload.OrderMerchantReference, payload.order_merchant_reference, payload.merchant_reference, data.bookingRef, data.orderRef, data.OrderMerchantReference, data.order_merchant_reference, data.merchant_reference, meta.bookingRef, meta.booking_ref, meta.custom_fields?.bookingRef, meta.custom_fields?.booking_ref, payload.tx_ref, payload.trxref, data.tx_ref, data.trxref),
    providerReference: originalPaymentReference,
    providerRefundReference,
    refundLifecycleStatus: lifecycle,
    amount: webhookAmount(provider, rawAmount, normalizedCurrency),
    amountProvided: rawAmount !== undefined,
    currency: normalizedCurrency,
    currencyProvided: rawCurrency !== undefined,
    status: lifecycle === 'completed'
      ? 'refunded'
      : normalizedStatus(pickFirst(payload.status, payload.payment_status_description, payload.paymentStatusDescription, data.status, data.payment_status_description, data.paymentStatusDescription, payload.event_type, data.gateway_response)),
    idempotencyKey: pickFirst(payload.idempotencyKey, payload.eventId, payload.event_id, lifecycle && `${eventName}:${providerRefundReference || originalPaymentReference}`, payload.providerReference, payload.OrderTrackingId, payload.order_tracking_id, data.id, data.reference, data.OrderTrackingId, data.order_tracking_id, payload.reference),
    meta,
    originalPayload: payload,
  };
}

function normalizedStatus(status = '') {
  const value = String(status || '').toLowerCase();
  if (['successful', 'success', 'paid', 'completed'].includes(value)) return 'successful';
  if (['failed', 'declined', 'cancelled'].includes(value)) return 'failed';
  if (['refunded', 'reversed'].includes(value)) return 'refunded';
  return value || 'pending';
}

function applyHotelPaymentLifecycle(booking, status) {
  if (String(booking?.serviceType || '').toLowerCase() !== 'hotel') return booking;
  const now = new Date().toISOString();
  if (status === 'successful') {
    booking.bookingStatus = 'confirmed';
    booking.lockedUntil = null;
    booking.settlementStatus = ['eligible', 'settled'].includes(String(booking.settlementStatus || '').toLowerCase()) ? booking.settlementStatus : 'pending_fulfillment';
    booking.hotelStay = { ...(booking.hotelStay || {}), status: 'booked' };
    booking.bookingItems = (booking.bookingItems || []).map((item) => ({ ...item, status: 'confirmed' }));
    booking.ticketLegs = (booking.ticketLegs || []).map((leg) => ({ ...leg, status: 'valid', issuedAt: leg.issuedAt || now }));
  } else if (status === 'refunded') {
    booking.bookingStatus = 'refunded';
    booking.lockedUntil = null;
    booking.settlementStatus = 'refunded';
    booking.hotelStay = { ...(booking.hotelStay || {}), status: 'refunded' };
    booking.bookingItems = (booking.bookingItems || []).map((item) => ({ ...item, status: 'refunded' }));
    booking.ticketLegs = (booking.ticketLegs || []).map((leg) => ({ ...leg, status: 'refunded', refundedAt: leg.refundedAt || now }));
  } else if (['failed', 'expired', 'cancelled'].includes(status)) {
    booking.bookingStatus = status === 'expired' ? 'expired' : 'failed';
    booking.lockedUntil = null;
    booking.settlementStatus = 'pending_payment';
    booking.hotelStay = { ...(booking.hotelStay || {}), status: booking.bookingStatus };
    booking.bookingItems = (booking.bookingItems || []).map((item) => ({ ...item, status: booking.bookingStatus }));
    booking.ticketLegs = (booking.ticketLegs || []).map((leg) => ({ ...leg, status: 'cancelled', cancelledAt: leg.cancelledAt || now }));
  } else if (['created', 'pending', 'processing'].includes(status)) {
    booking.bookingStatus = 'pending_payment';
    booking.settlementStatus = 'pending_payment';
    booking.hotelStay = { ...(booking.hotelStay || {}), status: 'pending_payment' };
    booking.bookingItems = (booking.bookingItems || []).map((item) => ({ ...item, status: 'awaiting_payment' }));
    booking.ticketLegs = (booking.ticketLegs || []).map((leg) => ({ ...leg, status: 'pending_payment' }));
  }
  return booking;
}

async function loadBookingForWebhook(bookingRef) {
  if (!bookingRef) return null;
  return commerceRepository.bookings.findOne({ bookingRef });
}
async function paymentBoundToWebhook(payload = {}) {
  if (!payload.providerReference) return null;
  return commerceRepository.payments.findOne({
    provider: payload.provider || env.paymentProvider,
    providerReference: payload.providerReference,
  });
}
async function loadBookingGroupForWebhook(groupRef) {
  if (!groupRef) return null;
  return commerceRepository.bookingGroups.findOne({ $or: [{ groupRef }, { cartRef: groupRef }] });
}
async function loadBookingsForGroup(group = {}) {
  const refs = Array.isArray(group.bookingRefs) ? group.bookingRefs : [];
  if (refs.length) return commerceRepository.bookings.list({ bookingRef: { $in: refs } });
  return commerceRepository.bookings.list({ bookingGroupRef: group.groupRef });
}
async function releaseCancelledInventory(booking = {}) {
  const now = new Date().toISOString();
  booking.ticketLegs = (booking.ticketLegs || []).map((leg) => ({ ...leg, status: leg.status === 'valid' ? 'cancelled' : leg.status, checkInStatus: ['boarding', 'not_checked'].includes(leg.checkInStatus) ? 'cancelled' : leg.checkInStatus, cancelledAt: now }));
  if (booking.serviceType === 'bus') {
    const claims = (booking.bookingItems || []).filter((item) => item.scheduleId && item.seatNumber);
    for (const claim of claims) {
      const seat = await commerceRepository.seats.findOne({ scheduleId: claim.scheduleId, seatNumber: claim.seatNumber });
      if (seat && (!seat.bookingRef || seat.bookingRef === booking.bookingRef)) {
        Object.assign(seat, { status: 'available', bookingRef: '', bookingId: '', passengerName: '', passengerPhone: '', passengerEmail: '' }); delete seat.lockedUntil; delete seat.lockId;
        await commerceRepository.seats.save(seat, { id: seat.id });
      }
    }
    for (const scheduleId of [...new Set(claims.map((row) => row.scheduleId))]) {
      const schedule = await commerceRepository.schedules.findOne({ id: scheduleId });
      if (schedule) { schedule.availableSeats = await commerceRepository.seats.count({ scheduleId, status: 'available' }); await commerceRepository.schedules.save(schedule, { id: schedule.id }); }
    }
  }
  if (booking.serviceType === 'hotel') {
    const nights = await commerceRepository.roomNights.list({ bookingRef: booking.bookingRef });
    for (const night of nights) {
      Object.assign(night, { availableInventory: 1, status: 'open', bookingRef: '', guestName: '', checkInStatus: '' }); delete night.holdId;
      await commerceRepository.roomNights.save(night, { id: night.id });
    }
  }
}

async function persistHotelNightLifecycle(booking = {}, paymentStatus = 'pending', session) {
  if (String(booking.serviceType || '').toLowerCase() !== 'hotel' || !booking.bookingRef) return null;
  const canonical = await hotelRepository.applyPaymentLifecycle({
    bookingRef: booking.bookingRef,
    companyId: booking.companyId || '',
    paymentStatus,
    reason: `Payment lifecycle changed to ${paymentStatus}`,
    session,
  });
  if (canonical?.reservation) return canonical;

  // Temporary compatibility for hotel bookings created before the normalized
  // reservation migration. New bookings always use HotelReservation records.
  const nights = await commerceRepository.roomNights.list({ bookingRef: booking.bookingRef }, { session });
  let updated = 0;
  for (const night of nights) {
    const operational = ['occupied', 'checked_in', 'checked_out', 'cleaning', 'maintenance'].includes(String(night.status || '').toLowerCase());
    if (paymentStatus === 'successful') {
      const result = await commerceRepository.roomNights.updateOne({ id: night.id, bookingRef: booking.bookingRef }, { $set: { status: 'booked', availableInventory: 0, checkInStatus: night.checkInStatus || 'not_checked' } }, { session });
      updated += Number(result?.modifiedCount ?? result?.nModified ?? 0);
    } else if (['created', 'pending', 'processing'].includes(paymentStatus)) {
      const result = await commerceRepository.roomNights.updateOne({ id: night.id, bookingRef: booking.bookingRef }, { $set: { status: 'reserved', availableInventory: 0 } }, { session });
      updated += Number(result?.modifiedCount ?? result?.nModified ?? 0);
    } else if (['failed', 'expired', 'cancelled', 'refunded'].includes(paymentStatus) && !operational) {
      const result = await commerceRepository.roomNights.updateOne({ id: night.id, bookingRef: booking.bookingRef }, { $set: { status: 'available', availableInventory: 1, bookingRef: '', reservationId: '', assignmentId: '', guestName: '', checkInStatus: '' }, $unset: { holdId: '' } }, { session });
      updated += Number(result?.modifiedCount ?? result?.nModified ?? 0);
    }
  }
  return { reservation: null, nightsUpdated: updated, inventoryReleased: updated };
}

async function persistPaymentState(payment, bookingOrGroup, bookings = []) {
  await commerceRepository.withTransaction(async (session) => {
    await commerceRepository.payments.save(payment, { idempotencyKey: payment.idempotencyKey }, { session });
    if (bookingOrGroup.groupRef) await commerceRepository.bookingGroups.save(bookingOrGroup, { groupRef: bookingOrGroup.groupRef }, { session });
    else {
      await commerceRepository.bookings.save(bookingOrGroup, { bookingRef: bookingOrGroup.bookingRef }, { session });
      await persistHotelNightLifecycle(bookingOrGroup, payment.status, session);
    }
    for (const booking of bookings) {
      await commerceRepository.bookings.save(booking, { bookingRef: booking.bookingRef }, { session });
      await persistHotelNightLifecycle(booking, payment.status, session);
    }
    const intentRef = bookingOrGroup.groupRef || bookingOrGroup.bookingRef;
    const exactIntentFilter = {
      bookingRef: intentRef,
      provider: payment.provider,
      ...(payment.providerReference ? { providerReference: payment.providerReference } : {}),
    };
    let intent = await commerceRepository.paymentIntents.findOne(exactIntentFilter, { session });
    if (!intent && !payment.providerReference) {
      intent = await commerceRepository.paymentIntents.findOne({ bookingRef: intentRef, provider: payment.provider }, { session });
    }
    if (intent) {
      const intentStatus = payment.status === 'refunded'
        ? 'successful'
        : (['created', 'pending', 'processing', 'successful', 'failed', 'expired', 'cancelled'].includes(payment.status) ? payment.status : 'pending');
      Object.assign(intent, {
        status: intentStatus,
        paidAt: payment.paidAt || intent.paidAt || null,
        failedAt: payment.status === 'failed' ? new Date().toISOString() : null,
        providerReference: payment.providerReference,
        checkoutUrl: payment.checkoutUrl || '',
        metadata: { ...(intent.metadata || {}), webhookPaymentId: payment.id, paymentLifecycleStatus: payment.status },
      });
      await commerceRepository.paymentIntents.save(intent, { idempotencyKey: intent.idempotencyKey }, { session });
    }
  });
}
function assertAmountAndCurrency(target, payload, entityType) {
  const expectedAmount = Number(target.pricing?.total || target.grossAmount || 0); const receivedAmount = Number(payload.amount || 0);
  const expectedCurrency = String(target.pricing?.currency || platformCurrency()).toUpperCase(); const receivedCurrency = String(payload.currency || expectedCurrency).toUpperCase();
  const status = normalizedStatus(payload.status);
  if (['successful', 'refunded'].includes(status) && (!payload.amountProvided || !Number.isFinite(receivedAmount) || receivedAmount <= 0)) { const error = new Error(`Payment webhook amount is missing for the ${entityType}`); error.status = 409; error.code = 'PAYMENT_AMOUNT_MISSING'; throw error; }
  if (['successful', 'refunded'].includes(status) && !payload.currencyProvided) { const error = new Error(`Payment webhook currency is missing for the ${entityType}`); error.status = 409; error.code = 'PAYMENT_CURRENCY_MISSING'; throw error; }
  if ((payload.amountProvided || ['successful', 'refunded'].includes(status)) && expectedAmount && Math.abs(receivedAmount - expectedAmount) > 0.0001) { const error = new Error(`Payment webhook amount does not match the ${entityType}`); error.status = 409; error.code = 'PAYMENT_AMOUNT_MISMATCH'; throw error; }
  if ((payload.currencyProvided || ['successful', 'refunded'].includes(status)) && receivedCurrency !== expectedCurrency) { const error = new Error(`Payment webhook currency does not match the ${entityType}`); error.status = 409; error.code = 'PAYMENT_CURRENCY_MISMATCH'; throw error; }
}

function assertRefundAmountAndCurrency(refund, payload) {
  const expectedAmount = Number(refund.amount || 0);
  const receivedAmount = Number(payload.amount || 0);
  const expectedCurrency = String(refund.currency || '').toUpperCase();
  const receivedCurrency = String(payload.currency || '').toUpperCase();
  if (!payload.amountProvided || !Number.isFinite(receivedAmount) || receivedAmount <= 0) {
    const error = new Error('Completed refund webhook amount is missing'); error.status = 409; error.code = 'REFUND_AMOUNT_MISSING'; throw error;
  }
  if (!payload.currencyProvided && String(payload.provider || '').toLowerCase() !== 'flutterwave') {
    const error = new Error('Completed refund webhook currency is missing'); error.status = 409; error.code = 'REFUND_CURRENCY_MISSING'; throw error;
  }
  if (Math.abs(receivedAmount - expectedAmount) > 0.0001) {
    const error = new Error('Refund webhook amount does not match the approved refund request'); error.status = 409; error.code = 'REFUND_AMOUNT_MISMATCH'; throw error;
  }
  if (payload.currencyProvided && receivedCurrency !== expectedCurrency) {
    const error = new Error('Refund webhook currency does not match the approved refund request'); error.status = 409; error.code = 'REFUND_CURRENCY_MISMATCH'; throw error;
  }
}

async function findProviderRefund(bookingRef, payload = {}) {
  const candidates = await commerceRepository.refunds.list({
    bookingRef,
    status: { $in: ['pending', 'reviewing', 'approved'] },
    provider: payload.provider || env.paymentProvider,
    providerRefundStatus: { $in: ['in_progress', 'accepted', 'reconciliation_required', 'failed', 'completed'] },
  }, { sort: { requestedAt: -1, createdAt: -1 }, limit: 20 });
  return candidates.find((refund) => {
    if (payload.providerReference && refund.providerPaymentReference && String(refund.providerPaymentReference) !== String(payload.providerReference)) return false;
    if (payload.providerRefundReference && refund.providerRefundReference && String(refund.providerRefundReference) !== String(payload.providerRefundReference)) return false;
    return true;
  }) || null;
}

async function processProviderRefundWebhook(payload, headers, booking, refund) {
  if (!refund) {
    const error = new Error('No matching provider refund request was found for this webhook');
    error.status = 409;
    error.code = 'REFUND_REQUEST_MISMATCH';
    await persistWebhookEvent(payload, headers, { status: 'blocked', signatureStatus: 'verified', failureReason: error.message, outcome: 'provider_refund_request_mismatch' });
    await securityService.recordSecurityEvent({ eventType: 'payment_refund_webhook_mismatch', severity: 'critical', entityType: 'refund_request', status: 'blocked', reason: error.message, metadata: { bookingRef: booking.bookingRef, provider: payload.provider || '', providerReference: payload.providerReference || '', providerRefundReference: payload.providerRefundReference || '' } });
    throw error;
  }
  try {
    await assertProviderReferenceBound(booking.bookingRef, payload);
    if ((payload.refundLifecycleStatus || 'completed') === 'completed') assertRefundAmountAndCurrency(refund, payload);
  } catch (error) {
    await persistWebhookEvent(payload, headers, { status: 'blocked', signatureStatus: 'verified', failureReason: error.message, outcome: 'provider_refund_validation_failed' });
    await securityService.recordSecurityEvent({
      eventType: 'payment_refund_webhook_mismatch', severity: 'critical', entityType: 'refund_request', entityId: refund.id,
      status: 'blocked', reason: error.message,
      metadata: { bookingRef: booking.bookingRef, provider: payload.provider || '', providerReference: payload.providerReference || '', providerRefundReference: payload.providerRefundReference || '', amount: payload.amount, currency: payload.currency },
    });
    throw error;
  }
  const workflowService = require('../support/workflowService');
  const lifecycle = payload.refundLifecycleStatus || 'completed';
  let processedRefund = refund;
  if (lifecycle === 'completed') {
    processedRefund = await workflowService.completeProviderRefund(booking.bookingRef, payload.provider, payload.providerRefundReference || '') || refund;
  } else if (['failed', 'needs_attention'].includes(lifecycle)) {
    const reason = pickFirst(payload.originalPayload?.message, payload.originalPayload?.data?.message, payload.originalPayload?.data?.gateway_response, `Provider refund ${lifecycle}`);
    processedRefund = await workflowService.failProviderRefund(booking.bookingRef, payload.provider, payload.providerRefundReference || '', reason) || refund;
  } else {
    await commerceRepository.refunds.updateOne({ id: refund.id, providerRefundStatus: { $in: ['in_progress', 'accepted'] } }, { $set: {
      providerRefundStatus: 'accepted',
      providerRefundReference: payload.providerRefundReference || refund.providerRefundReference || '',
      providerRefundError: '',
      updatedAt: new Date().toISOString(),
    } });
    processedRefund = await commerceRepository.refunds.findOne({ id: refund.id });
  }
  await persistWebhookEvent(payload, headers, { status: 'processed', signatureStatus: 'verified', processedAt: new Date(), outcome: `provider_refund_${lifecycle}` });
  return { valid: true, processed: true, refundLifecycle: lifecycle, refund: processedRefund, booking: await loadBookingForWebhook(booking.bookingRef) || booking };
}

function webhookTransitionAllowed(target = {}, incomingStatus = '') {
  const current = normalizedStatus(target.paymentStatus || target.status || 'pending');
  const incoming = normalizedStatus(incomingStatus);
  if (current === 'refunded' && incoming !== 'refunded') return false;
  if (current === 'successful' && !['successful', 'refunded'].includes(incoming)) return false;
  if (['failed', 'expired'].includes(current) && ['pending', 'processing', 'created'].includes(incoming)) return false;
  return true;
}

function paymentStateApplied(target = {}, incomingStatus = '') {
  const incoming = normalizedStatus(incomingStatus);
  const paymentStatus = normalizedStatus(target.paymentStatus || 'pending');
  const bookingStatus = normalizedStatus(target.bookingStatus || target.status || 'pending');
  if (incoming === 'successful') return paymentStatus === 'successful';
  if (incoming === 'refunded') return paymentStatus === 'refunded' || bookingStatus === 'refunded' || normalizedStatus(target.refundStatus) === 'refunded';
  if (incoming === 'failed') return paymentStatus === 'failed' || ['failed', 'cancelled', 'expired'].includes(bookingStatus);
  return ['pending', 'processing', 'created'].includes(paymentStatus);
}

function groupPaymentStateApplied(group = {}, bookings = [], incomingStatus = '') {
  return paymentStateApplied(group, incomingStatus)
    && bookings.every((booking) => paymentStateApplied(booking, incomingStatus));
}

function webhookIdempotencyKey(payload = {}, entityRef = '') {
  const provider = String(payload.provider || env.paymentProvider).toLowerCase();
  const raw = payload.idempotencyKey || payload.eventId || payload.providerReference || `${entityRef}:${normalizedStatus(payload.status)}`;
  return `${provider}:webhook:${raw}`.slice(0, 500);
}

async function assertProviderReferenceBound(bookingRef, payload = {}) {
  const providerReference = String(payload.providerReference || '').trim();
  if (!bookingRef || !providerReference) return true;
  const intents = await commerceRepository.paymentIntents.list({
    bookingRef,
    provider: payload.provider || env.paymentProvider,
    providerReference: { $nin: ['', null] },
  }, { limit: 20 });
  if (intents.length && !intents.some((intent) => String(intent.providerReference) === providerReference)) {
    const error = new Error('Payment webhook provider reference does not match the booking intent');
    error.status = 409;
    error.code = 'PAYMENT_REFERENCE_MISMATCH';
    throw error;
  }
  return true;
}
async function processBookingGroupWebhook(payload, headers, group) {
  const bookings = await loadBookingsForGroup(group);
  if (!bookings.length) { const error = new Error('Booking group has no child bookings'); error.status = 409; throw error; }
  assertAmountAndCurrency(group, payload, 'booking group');
  await assertProviderReferenceBound(group.groupRef, payload);
  const status = normalizedStatus(payload.status);
  if (!webhookTransitionAllowed(group, status)) {
    await persistWebhookEvent(payload, headers, { status: 'processed', signatureStatus: 'verified', processedAt: new Date(), outcome: 'ignored_stale_transition' });
    return { valid: true, ignored: true, reason: 'stale_payment_transition', bookingGroup: group, bookings };
  }
  const idempotencyKey = webhookIdempotencyKey(payload, group.groupRef);
  const claim = await securityService.claimIdempotencyKey({ key: idempotencyKey, scope: 'payment_webhook', entityType: 'booking_group', entityId: group.id, payload, metadata: { provider: payload.provider || env.paymentProvider, bookingGroupRef: group.groupRef } });
  const existing = await commerceRepository.payments.findOne({ $or: [{ idempotencyKey }, { provider: payload.provider || env.paymentProvider, providerReference: payload.providerReference || '' }] });
  // Failed charge events are deliberately re-applied. Their idempotent effect is
  // cleanup, so returning a stale failed Payment here would preserve an artifact
  // that the first (possibly interrupted) delivery was meant to remove.
  if (status !== 'failed' && (claim.replayed || existing) && existing && normalizedStatus(existing.status) === status && groupPaymentStateApplied(group, bookings, status)) {
    await persistWebhookEvent(payload, headers, { status: 'processed', signatureStatus: 'verified', processedAt: new Date(), outcome: 'idempotent_replay' });
    return { valid: true, idempotent: true, payment: existing, bookingGroup: group, bookings };
  }
  if (status === 'failed') {
    const bookingService = require('../booking/bookingService');
    for (const booking of bookings) {
      if (String(booking.serviceType || '').toLowerCase() === 'bus') {
        await busBookingService.failPayment(booking.bookingRef, 'Grouped payment failed by provider webhook', { provider: payload.provider, providerReference: payload.providerReference, source: 'booking_group_webhook' });
      } else if (String(booking.serviceType || '').toLowerCase() === 'hotel') {
        Object.assign(booking, { paymentStatus: 'failed', paymentProvider: payload.provider || env.paymentProvider, paymentRef: payload.providerReference || '', updatedAt: new Date().toISOString() });
        applyHotelPaymentLifecycle(booking, 'failed');
        await commerceRepository.withTransaction(async (session) => {
          await commerceRepository.bookings.save(booking, { bookingRef: booking.bookingRef }, { session });
          await persistHotelNightLifecycle(booking, 'failed', session);
        });
      } else if (String(booking.serviceType || '').toLowerCase() === 'flight') {
        await flightBookingService.failPayment(booking.bookingRef, 'Grouped payment failed by provider webhook', { provider: payload.provider, providerReference: payload.providerReference, source: 'booking_group_webhook' });
      } else if (String(booking.serviceType || '').toLowerCase() === 'local_transport') {
        await taxiRideService.failPayment(booking.bookingRef, 'Grouped payment failed by provider webhook', { provider: payload.provider, providerReference: payload.providerReference, source: 'booking_group_webhook' });
      } else {
        await bookingService.purgeFailedBookingArtifacts(booking, {}, 'Grouped payment failed by provider webhook');
      }
    }
    await commerceRepository.withTransaction(async (session) => {
      await commerceRepository.payments.deleteMany({ $or: [{ bookingId: group.id }, { bookingRef: group.groupRef }] }, { session });
      await commerceRepository.bookingGroups.deleteMany({ $or: [{ id: group.id }, { groupRef: group.groupRef }] }, { session });
      const intent = await commerceRepository.paymentIntents.findOne({ bookingRef: group.groupRef }, { session });
      if (intent) { intent.status = 'failed'; intent.failedAt = new Date().toISOString(); intent.failureReason = 'Payment failed by provider webhook'; await commerceRepository.paymentIntents.save(intent, { idempotencyKey: intent.idempotencyKey }, { session }); }
    });
    await persistWebhookEvent(payload, headers, { status: 'processed', signatureStatus: 'verified', processedAt: new Date(), outcome: 'failed_without_booking' });
    await securityService.completeIdempotency(claim.record, { bookingGroupRef: group.groupRef, status: 'failed', bookingPurged: true });
    return { valid: true, processed: true, payment: null, bookingGroup: null, bookings: [], booking: null };
  }
  const payment = { ...(existing || {}), id: existing?.id || await nextId('payment'), bookingId: group.id, bookingRef: group.groupRef, provider: payload.provider || env.paymentProvider, providerReference: payload.providerReference || payload.reference || idempotencyKey, amount: Number(payload.amount || group.pricing?.total || 0), grossAmount: Number(payload.amount || group.pricing?.total || 0), currency: payload.currency || group.pricing?.currency || platformCurrency(), status, paidAt: status === 'successful' ? (existing?.paidAt || new Date().toISOString()) : null, idempotencyKey: existing?.idempotencyKey || idempotencyKey, rawPayload: payload, metadata: { ...(existing?.metadata || {}), bookingGroupRef: group.groupRef, childBookingRefs: group.bookingRefs || [] }, createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
  Object.assign(group, { paymentId: payment.id, paymentRef: payment.providerReference, paymentProvider: payment.provider, paymentStatus: status, status: status === 'successful' ? 'confirmed' : status === 'failed' ? 'cancelled' : status === 'refunded' ? 'refunded' : 'pending_payment' });
  for (const booking of bookings) {
    if (['bus', 'flight', 'local_transport'].includes(String(booking.serviceType || '').toLowerCase())) continue;
    Object.assign(booking, { paymentStatus: status, paymentRef: payment.providerReference, paymentProvider: payment.provider, updatedAt: new Date().toISOString() });
    applyHotelPaymentLifecycle(booking, status);
    if (String(booking.serviceType || '').toLowerCase() !== 'hotel') {
      if (status === 'successful' && ['draft', 'pending', 'pending_payment'].includes(booking.bookingStatus)) booking.bookingStatus = 'confirmed';
      if (status === 'refunded') booking.bookingStatus = 'refunded';
    }
  }
  await persistPaymentState(payment, group, bookings);
  for (let index = 0; index < bookings.length; index += 1) {
    const booking = bookings[index];
    if (String(booking.serviceType || '').toLowerCase() === 'bus') {
      if (status === 'successful') bookings[index] = await busBookingService.confirmPayment(booking.bookingRef, { provider: payment.provider, providerReference: payment.providerReference, paymentId: payment.id, source: 'booking_group_webhook' });
      else if (status === 'failed') bookings[index] = await busBookingService.failPayment(booking.bookingRef, 'Grouped payment failed by provider webhook', { provider: payment.provider, providerReference: payment.providerReference, paymentId: payment.id, source: 'booking_group_webhook' });
      else if (status === 'refunded') bookings[index] = await busBookingService.refundBooking(booking.bookingRef, 'Grouped payment refund confirmed by provider', { provider: payment.provider, providerReference: payment.providerReference, paymentId: payment.id, source: 'booking_group_webhook' });
    } else if (String(booking.serviceType || '').toLowerCase() === 'flight') {
      if (status === 'successful') bookings[index] = await flightBookingService.confirmPayment(booking.bookingRef, { provider: payment.provider, providerReference: payment.providerReference, paymentId: payment.id, source: 'booking_group_webhook' });
      else if (status === 'failed') bookings[index] = await flightBookingService.failPayment(booking.bookingRef, 'Grouped payment failed by provider webhook', { provider: payment.provider, providerReference: payment.providerReference, paymentId: payment.id, source: 'booking_group_webhook' });
      else if (status === 'refunded') bookings[index] = await flightBookingService.confirmRefund(booking.bookingRef, { provider: payment.provider, providerReference: payment.providerReference, source: 'booking_group_webhook' });
    } else if (String(booking.serviceType || '').toLowerCase() === 'local_transport') {
      if (status === 'successful') bookings[index] = await taxiRideService.confirmPayment(booking.bookingRef, { provider: payment.provider, providerReference: payment.providerReference, paymentId: payment.id, source: 'booking_group_webhook' });
      else if (status === 'failed') bookings[index] = await taxiRideService.failPayment(booking.bookingRef, 'Grouped payment failed by provider webhook', { provider: payment.provider, providerReference: payment.providerReference, paymentId: payment.id, source: 'booking_group_webhook' });
      else if (status === 'refunded') bookings[index] = await taxiRideService.confirmRefund(booking.bookingRef, { provider: payment.provider, providerReference: payment.providerReference, source: 'booking_group_webhook' });
    } else if (status === 'successful') Object.assign(booking, await paymentSettlementService.settleBookingPayment(booking, { source: 'booking_group_webhook' }) || {});
  }
  await persistWebhookEvent(payload, headers, { status: 'processed', signatureStatus: 'verified', processedAt: new Date() });
  for (const booking of bookings) {
    await notificationService.paymentUpdated(booking, payment);
    if (status === 'successful' && String(booking.serviceType || '').toLowerCase() === 'hotel') {
      await notificationService.bookingConfirmed(booking);
    }
  }
  await securityService.completeIdempotency(claim.record, { paymentId: payment.id, bookingGroupRef: group.groupRef, status: payment.status });
  return { valid: true, processed: true, payment, bookingGroup: group, bookings, booking: bookings[0] };
}

async function processPaymentWebhook(payload = {}, headers = {}) {
  payload = normalizeProviderPayload(payload);
  await persistWebhookEvent(payload, headers, { status: 'received', signatureStatus: 'unchecked' });
  try {
    let providerVerification = null;
    if (payload.provider === 'pesapal' && payload.providerReference) {
      providerVerification = await paymentService.handleWebhook(payload);
      if (providerVerification?.valid) {
        const originalPayload = payload.originalPayload || payload;
        payload = {
          ...payload,
          bookingRef: providerVerification.bookingRef || payload.bookingRef,
          providerReference: providerVerification.providerReference || payload.providerReference,
          amount: providerVerification.amount ?? payload.amount,
          amountProvided: providerVerification.amount !== undefined || payload.amountProvided,
          currency: providerVerification.currency || payload.currency,
          currencyProvided: providerVerification.currency !== undefined || payload.currencyProvided,
          status: providerVerification.status || payload.status,
          providerVerified: true,
          originalPayload,
          providerVerificationPayload: providerVerification.payload,
        };
      }
    }
    if (!providerVerification?.valid) assertValidSignature(payload, headers);
    await persistWebhookEvent(payload, headers, { signatureStatus: providerVerification?.valid ? 'verified_provider_status' : 'verified' });
  } catch (error) {
    await persistWebhookEvent(payload, headers, { status: 'blocked', signatureStatus: 'failed', failureReason: error.message });
    await securityService.recordSecurityEvent({ eventType: 'payment_webhook_signature_failed', severity: 'high', entityType: 'payment_webhook', status: 'blocked', reason: error.message, metadata: { provider: payload.provider || '', providerReference: payload.providerReference || payload.reference || '', payload } });
    throw error;
  }

  let bookingRef = payload.bookingRef || payload.meta?.bookingRef;
  let booking = await loadBookingForWebhook(bookingRef);
  if (!booking) {
    const boundPayment = await paymentBoundToWebhook(payload);
    if (boundPayment?.bookingRef) {
      bookingRef = boundPayment.bookingRef;
      booking = await loadBookingForWebhook(bookingRef);
    }
  }
  if (!booking) {
    const group = await loadBookingGroupForWebhook(bookingRef);
    if (group) return processBookingGroupWebhook(payload, headers, group);
    if (normalizedStatus(payload.status) === 'failed' && bookingRef) {
      const intent = await commerceRepository.paymentIntents.findOne({ bookingRef });
      if (intent) {
        intent.status = 'failed';
        intent.failedAt = new Date().toISOString();
        intent.failureReason = 'Payment failed by provider webhook after provisional booking cleanup';
        await commerceRepository.paymentIntents.save(intent, { idempotencyKey: intent.idempotencyKey });
        await commerceRepository.payments.deleteMany({ bookingRef });
        await persistWebhookEvent(payload, headers, { status: 'processed', signatureStatus: 'verified', processedAt: new Date(), outcome: 'failed_without_booking' });
        return { valid: true, processed: true, payment: null, booking: null };
      }
    }
    const error = new Error('Booking or booking group not found for payment webhook'); error.status = 404; throw error;
  }

  const status = normalizedStatus(payload.status);
  const matchingRefund = await findProviderRefund(booking.bookingRef, payload);
  if (payload.refundLifecycleStatus || (status === 'refunded' && matchingRefund)) {
    return processProviderRefundWebhook(payload, headers, booking, matchingRefund);
  }
  if (!webhookTransitionAllowed(booking, status)) {
    await persistWebhookEvent(payload, headers, { status: 'processed', signatureStatus: 'verified', processedAt: new Date(), outcome: 'ignored_stale_transition' });
    return { valid: true, ignored: true, reason: 'stale_payment_transition', booking };
  }
  try {
    await assertProviderReferenceBound(booking.bookingRef, payload);
    assertAmountAndCurrency(booking, payload, 'booking');
  }
  catch (error) {
    const eventType = error.code === 'PAYMENT_REFERENCE_MISMATCH'
      ? 'payment_webhook_reference_mismatch'
      : error.code === 'PAYMENT_CURRENCY_MISMATCH' || error.code === 'PAYMENT_CURRENCY_MISSING'
        ? 'payment_webhook_currency_mismatch'
        : 'payment_webhook_amount_mismatch';
    await securityService.recordSecurityEvent({ eventType, severity: 'critical', entityType: 'booking', entityId: booking.id, status: 'blocked', reason: error.message, metadata: { bookingRef: booking.bookingRef, provider: payload.provider || '', providerReference: payload.providerReference || payload.reference || '', amount: payload.amount, currency: payload.currency } });
    throw error;
  }

  const idempotencyKey = webhookIdempotencyKey(payload, booking.bookingRef);
  const claim = await securityService.claimIdempotencyKey({ key: idempotencyKey, scope: 'payment_webhook', entityType: 'booking', entityId: booking.id, payload, metadata: { provider: payload.provider || env.paymentProvider, bookingRef: booking.bookingRef } });
  const existing = await commerceRepository.payments.findOne({ $or: [{ idempotencyKey }, { provider: payload.provider || env.paymentProvider, providerReference: payload.providerReference || '' }] });
  // Never short-circuit a failed charge event while a Payment row still exists.
  // Re-running the canonical failure path is safe and completes stale cleanup.
  // Provider refund failures have already returned through the isolated refund
  // lifecycle above and therefore cannot reach this charge-failure path.
  if (status !== 'failed' && (claim.replayed || existing) && existing && normalizedStatus(existing.status) === status && paymentStateApplied(booking, status)) {
    if (existing && claim.record.status !== 'completed') await securityService.completeIdempotency(claim.record, { paymentId: existing.id, bookingRef: booking.bookingRef, status: existing.status });
    await persistWebhookEvent(payload, headers, { status: 'processed', signatureStatus: 'verified', processedAt: new Date(), outcome: 'idempotent_replay' });
    return { valid: true, idempotent: true, payment: existing, booking };
  }
  if (status === 'failed') {
    if (String(booking.serviceType || '').toLowerCase() === 'bus') {
      await busBookingService.failPayment(booking.bookingRef, 'Payment failed by provider webhook', { provider: payload.provider, providerReference: payload.providerReference, source: 'payment_webhook' });
    } else if (String(booking.serviceType || '').toLowerCase() === 'hotel') {
      Object.assign(booking, { paymentStatus: 'failed', paymentProvider: payload.provider || env.paymentProvider, paymentRef: payload.providerReference || '', updatedAt: new Date().toISOString() });
      applyHotelPaymentLifecycle(booking, 'failed');
      await commerceRepository.withTransaction(async (session) => {
        await commerceRepository.bookings.save(booking, { bookingRef: booking.bookingRef }, { session });
        await persistHotelNightLifecycle(booking, 'failed', session);
      });
    } else if (String(booking.serviceType || '').toLowerCase() === 'flight') {
      await flightBookingService.failPayment(booking.bookingRef, 'Payment failed by provider webhook', { provider: payload.provider, providerReference: payload.providerReference, source: 'payment_webhook' });
    } else if (String(booking.serviceType || '').toLowerCase() === 'local_transport') {
      await taxiRideService.failPayment(booking.bookingRef, 'Payment failed by provider webhook', { provider: payload.provider, providerReference: payload.providerReference, source: 'payment_webhook' });
    } else {
      await require('../booking/bookingService').purgeFailedBookingArtifacts(booking, {}, 'Payment failed by provider webhook');
    }
    await commerceRepository.payments.deleteMany({ $or: [{ bookingId: booking.id }, { bookingRef: booking.bookingRef }] });
    const intent = await commerceRepository.paymentIntents.findOne({ bookingRef: booking.bookingRef, provider: payload.provider || env.paymentProvider });
    if (intent) { intent.status = 'failed'; intent.failedAt = new Date().toISOString(); intent.failureReason = 'Payment failed by provider webhook'; await commerceRepository.paymentIntents.save(intent, { idempotencyKey: intent.idempotencyKey }); }
    await persistWebhookEvent(payload, headers, { status: 'processed', signatureStatus: 'verified', processedAt: new Date(), outcome: 'failed_without_booking' });
    await securityService.completeIdempotency(claim.record, { bookingRef: booking.bookingRef, status: 'failed', bookingPurged: true });
    return { valid: true, processed: true, payment: null, booking: null };
  }

  const payment = {
    ...(existing || {}),
    id: existing?.id || await nextId('payment'), bookingId: booking.id, bookingRef: booking.bookingRef, companyId: booking.companyId, customerUserId: booking.customerUserId || '',
    provider: payload.provider || env.paymentProvider, providerReference: payload.providerReference || payload.reference || idempotencyKey,
    amount: Number(payload.amount || booking.pricing?.total || 0), grossAmount: Number(payload.amount || booking.pricing?.total || 0), currency: payload.currency || booking.pricing?.currency || platformCurrency(),
    status, paidAt: status === 'successful' ? (existing?.paidAt || new Date().toISOString()) : null, idempotencyKey: existing?.idempotencyKey || idempotencyKey, rawPayload: payload, createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  let processedBooking = booking;
  if (String(booking.serviceType || '').toLowerCase() === 'bus') {
    // Persist the verified provider transaction first; the canonical bus service owns
    // all reservation, segment inventory, ticket, and booking status transitions.
    await persistPaymentState(payment, booking);
    if (status === 'successful') processedBooking = await busBookingService.confirmPayment(booking.bookingRef, { provider: payment.provider, providerReference: payment.providerReference, paymentId: payment.id, source: 'payment_webhook' });
    else if (status === 'refunded') processedBooking = await busBookingService.refundBooking(booking.bookingRef, 'Refund confirmed by payment provider', { provider: payment.provider, providerReference: payment.providerReference, paymentId: payment.id, source: 'payment_webhook' });
    else {
      Object.assign(booking, { paymentStatus: status, paymentProvider: payment.provider, paymentRef: payment.providerReference, updatedAt: new Date().toISOString() });
      await commerceRepository.bookings.save(booking, { bookingRef: booking.bookingRef });
      processedBooking = booking;
    }
  } else if (String(booking.serviceType || '').toLowerCase() === 'flight') {
    await persistPaymentState(payment, booking);
    if (status === 'successful') processedBooking = await flightBookingService.confirmPayment(booking.bookingRef, { provider: payment.provider, providerReference: payment.providerReference, paymentId: payment.id, source: 'payment_webhook' });
    else if (status === 'refunded') processedBooking = await flightBookingService.confirmRefund(booking.bookingRef, { provider: payment.provider, providerReference: payment.providerReference, source: 'payment_webhook' });
    else processedBooking = booking;
  } else if (String(booking.serviceType || '').toLowerCase() === 'local_transport') {
    await persistPaymentState(payment, booking);
    if (status === 'successful') processedBooking = await taxiRideService.confirmPayment(booking.bookingRef, { provider: payment.provider, providerReference: payment.providerReference, paymentId: payment.id, source: 'payment_webhook' });
    else if (status === 'refunded') processedBooking = await taxiRideService.confirmRefund(booking.bookingRef, { provider: payment.provider, providerReference: payment.providerReference, source: 'payment_webhook' });
    else processedBooking = booking;
  } else {
    Object.assign(booking, { paymentStatus: status, paymentProvider: payment.provider, paymentRef: payment.providerReference, updatedAt: new Date().toISOString() });
    applyHotelPaymentLifecycle(booking, status);
    await persistPaymentState(payment, booking);
    if (status === 'successful') Object.assign(booking, await paymentSettlementService.settleBookingPayment(booking, { source: 'payment_webhook' }) || {});
    processedBooking = booking;
  }
  await persistWebhookEvent(payload, headers, { status: 'processed', signatureStatus: 'verified', processedAt: new Date() });
  await notificationService.paymentUpdated(processedBooking, payment);
  if (status === 'successful' && String(processedBooking.serviceType || '').toLowerCase() === 'hotel') {
    await notificationService.bookingConfirmed(processedBooking);
  }
  await securityService.completeIdempotency(claim.record, { paymentId: payment.id, bookingRef: processedBooking.bookingRef, status: payment.status });
  return { valid: true, processed: true, payment, booking: processedBooking };
}

module.exports = {
  processPaymentWebhook,
  signPayload,
  stableStringify,
  normalizeProviderPayload,
  normalizedStatus,
  assertAmountAndCurrency,
  assertRefundAmountAndCurrency,
  webhookTransitionAllowed,
  paymentStateApplied,
  groupPaymentStateApplied,
  webhookIdempotencyKey,
};

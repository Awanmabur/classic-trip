const crypto = require('crypto');
const store = require('../data/persistentStore');
const notificationService = require('../notification/notificationService');
const securityService = require('../security/securityService');
const { env } = require('../../config/env');
const { mongoose } = require('../../config/db');

function mongoReady() {
  return mongoose.connection.readyState === 1;
}

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
  if (!mongoReady()) return null;
  const PaymentWebhookEvent = require('../../models/PaymentWebhookEvent');
  const idempotencyKey = payload.idempotencyKey || payload.eventId || `${payload.provider || 'provider'}:${payload.providerReference || payload.reference || payload.bookingRef || Date.now()}`;
  const row = {
    id: `webhook-${crypto.createHash('sha1').update(`${payload.provider || ''}:${idempotencyKey}`).digest('hex').slice(0, 16)}`,
    provider: payload.provider || 'mock',
    providerReference: payload.providerReference || payload.reference || '',
    bookingRef: payload.bookingRef || payload.reference || payload.meta?.bookingRef || '',
    idempotencyKey,
    status: 'received',
    signatureStatus: 'unchecked',
    amount: Number(payload.amount || 0),
    currency: payload.currency || 'UGX',
    eventType: payload.event || payload.type || payload.status || '',
    rawPayload: payload.originalPayload || payload,
    rawBodyHash: rawBodyHash(headers),
    ...patch,
  };
  await PaymentWebhookEvent.updateOne(
    { provider: row.provider, idempotencyKey: row.idempotencyKey },
    { $set: row },
    { upsert: true, runValidators: true }
  );
  return row;
}

function assertValidSignature(payload, headers = {}) {
  const providerName = payload.provider || env.paymentProvider || 'mock';
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

function normalizeProviderPayload(payload = {}) {
  const data = payload.data || payload.event || payload.transaction || {};
  const meta = payload.meta || payload.metadata || data.meta || data.metadata || data.customer || {};
  const provider = pickFirst(payload.provider, data.provider, payload.source, 'mock');
  return {
    ...payload,
    provider,
    bookingRef: pickFirst(payload.bookingRef, payload.orderRef, data.bookingRef, data.orderRef, meta.bookingRef, meta.booking_ref, meta.custom_fields?.bookingRef, meta.custom_fields?.booking_ref, payload.tx_ref, payload.trxref, data.tx_ref, data.trxref, payload.reference, data.reference),
    providerReference: pickFirst(payload.providerReference, payload.transaction_id, payload.flw_ref, payload.reference, payload.tx_ref, data.providerReference, data.id, data.reference, data.flw_ref, data.tx_ref),
    amount: Number(pickFirst(payload.amount, data.amount, data.charged_amount, data.requested_amount, meta.amount, 0)),
    currency: String(pickFirst(payload.currency, data.currency, meta.currency, 'UGX')).toUpperCase(),
    status: normalizedStatus(pickFirst(payload.status, data.status, payload.event_type, data.gateway_response)),
    idempotencyKey: pickFirst(payload.idempotencyKey, payload.eventId, payload.event_id, data.id, data.reference, payload.providerReference, payload.reference),
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

async function loadBookingForWebhook(bookingRef) {
  const fromCache = store.findBooking(bookingRef);
  if (fromCache) return fromCache;
  if (!mongoReady() || !bookingRef) return null;
  const Booking = require('../../models/Booking');
  const booking = await Booking.findOne({ bookingRef }).lean();
  if (!booking) return null;
  if (!booking.id && booking._id) booking.id = String(booking._id);
  delete booking._id;
  delete booking.__v;
  const existingIndex = store.state.bookings.findIndex((row) => row.bookingRef === booking.bookingRef);
  if (existingIndex >= 0) store.state.bookings[existingIndex] = booking;
  else store.state.bookings.unshift(booking);
  return booking;
}

async function releaseCancelledInventory(booking = {}) {
  const now = new Date().toISOString();
  if (booking.serviceType !== 'bus') return;
  const seatClaims = (booking.bookingItems || []).filter((item) => item.scheduleId && item.seatNumber);
  if (!seatClaims.length) return;
  booking.ticketLegs = (booking.ticketLegs || []).map((leg) => ({ ...leg, status: leg.status === 'valid' ? 'cancelled' : leg.status, checkInStatus: ['boarding', 'not_checked'].includes(leg.checkInStatus) ? 'cancelled' : leg.checkInStatus, cancelledAt: now }));
  for (const claim of seatClaims) {
    const seat = store.state.seats.find((item) => item.scheduleId === claim.scheduleId && item.seatNumber === claim.seatNumber);
    if (seat && seat.status === 'taken') {
      seat.status = 'available';
      seat.lockedUntil = null;
      seat.lockId = null;
    }
    const schedule = store.state.schedules.find((item) => item.id === claim.scheduleId);
    if (schedule) schedule.availableSeats = Number(schedule.availableSeats || 0) + 1;
  }
  if (!mongoReady()) return;
  const Seat = require('../../models/Seat');
  const TripSchedule = require('../../models/TripSchedule');
  await Seat.bulkWrite(seatClaims.map((claim) => ({
    updateOne: {
      filter: { scheduleId: claim.scheduleId, seatNumber: claim.seatNumber, status: 'taken' },
      update: { $set: { status: 'available' }, $unset: { lockedUntil: '', lockId: '', bookingRef: '' } },
    },
  })), { ordered: false });
  const scheduleCounts = seatClaims.reduce((acc, claim) => { acc[claim.scheduleId] = (acc[claim.scheduleId] || 0) + 1; return acc; }, {});
  await TripSchedule.bulkWrite(Object.entries(scheduleCounts).map(([id, count]) => ({
    updateOne: { filter: { id }, update: { $inc: { availableSeats: count } } },
  })), { ordered: false });
}

async function persistPaymentAndBooking(payment, booking) {
  if (!mongoReady()) return;
  const Payment = require('../../models/Payment');
  const Booking = require('../../models/Booking');
  const PaymentIntent = require('../../models/PaymentIntent');
  await Payment.updateOne(
    { idempotencyKey: payment.idempotencyKey },
    { $set: payment },
    { upsert: true, runValidators: true }
  );
  await Booking.updateOne(
    { bookingRef: booking.bookingRef },
    { $set: { paymentStatus: booking.paymentStatus, bookingStatus: booking.bookingStatus, cancelReason: booking.cancelReason || '', cancelledAt: booking.cancelledAt || null, ticketLegs: booking.ticketLegs || [] } }
  );
  await PaymentIntent.updateOne(
    { bookingRef: booking.bookingRef, provider: payment.provider },
    { $set: { status: payment.status, paidAt: payment.paidAt || null, failedAt: payment.status === 'failed' ? new Date() : null, providerReference: payment.providerReference, checkoutUrl: payment.checkoutUrl || '', metadata: { webhookPaymentId: payment.id } } },
    { upsert: false }
  );
}

async function processPaymentWebhook(payload = {}, headers = {}) {
  payload = normalizeProviderPayload(payload);
  await persistWebhookEvent(payload, headers, { status: 'received', signatureStatus: 'unchecked' });
  try {
    assertValidSignature(payload, headers);
    await persistWebhookEvent(payload, headers, { signatureStatus: 'verified' });
  } catch (error) {
    await persistWebhookEvent(payload, headers, { status: 'blocked', signatureStatus: 'failed', failureReason: error.message });
    await securityService.recordSecurityEvent({
      eventType: 'payment_webhook_signature_failed',
      severity: 'high',
      entityType: 'payment_webhook',
      status: 'blocked',
      reason: error.message,
      metadata: { provider: payload.provider || '', providerReference: payload.providerReference || payload.reference || '', payload },
    });
    throw error;
  }
  const bookingRef = payload.bookingRef || payload.reference || payload.meta?.bookingRef;
  const booking = await loadBookingForWebhook(bookingRef);
  if (!booking) {
    const billingService = require('../billing/billingService');
    const billingResult = await billingService.processPaymentWebhook(payload);
    if (billingResult) return billingResult;
    const error = new Error('Booking or subscription order not found for payment webhook');
    error.status = 404;
    throw error;
  }

  const expectedAmount = Number(booking.pricing?.total || booking.grossAmount || 0);
  const receivedAmount = Number(payload.amount || 0);
  const expectedCurrency = String(booking.pricing?.currency || 'UGX').toUpperCase();
  const receivedCurrency = String(payload.currency || expectedCurrency).toUpperCase();
  if (receivedAmount && expectedAmount && receivedAmount !== expectedAmount) {
    await securityService.recordSecurityEvent({
      eventType: 'payment_webhook_amount_mismatch',
      severity: 'critical',
      entityType: 'booking',
      entityId: booking.id,
      status: 'blocked',
      reason: `Webhook amount ${receivedAmount} does not match booking amount ${expectedAmount}`,
      metadata: { bookingRef: booking.bookingRef, provider: payload.provider || '', providerReference: payload.providerReference || payload.reference || '' },
    });
    const error = new Error('Payment webhook amount does not match the booking');
    error.status = 409;
    throw error;
  }
  if (receivedCurrency !== expectedCurrency) {
    await securityService.recordSecurityEvent({
      eventType: 'payment_webhook_currency_mismatch',
      severity: 'critical',
      entityType: 'booking',
      entityId: booking.id,
      status: 'blocked',
      reason: `Webhook currency ${receivedCurrency} does not match booking currency ${expectedCurrency}`,
      metadata: { bookingRef: booking.bookingRef, provider: payload.provider || '', providerReference: payload.providerReference || payload.reference || '' },
    });
    const error = new Error('Payment webhook currency does not match the booking');
    error.status = 409;
    throw error;
  }

  if (!Array.isArray(store.state.payments)) store.state.payments = [];
  const status = normalizedStatus(payload.status);
  const idempotencyKey = payload.idempotencyKey || payload.eventId || payload.providerReference || `${payload.provider || 'mock'}:${booking.bookingRef}:${status}`;
  const claim = await securityService.claimIdempotencyKey({
    key: idempotencyKey,
    scope: 'payment_webhook',
    entityType: 'booking',
    entityId: booking.id,
    payload,
    metadata: { provider: payload.provider || 'mock', bookingRef: booking.bookingRef },
  });
  const existing = store.state.payments.find((payment) => payment.idempotencyKey === idempotencyKey);
  if (claim.replayed || existing) {
    if (existing && claim.record.status !== 'completed') await securityService.completeIdempotency(claim.record, { paymentId: existing.id, bookingRef: booking.bookingRef, status: existing.status });
    return { valid: true, idempotent: true, payment: existing, booking };
  }

  const payment = {
    id: `payment-${store.state.payments.length + 1}`,
    bookingId: booking.id,
    bookingRef: booking.bookingRef,
    provider: payload.provider || 'mock',
    providerReference: payload.providerReference || payload.reference || idempotencyKey,
    amount: Number(payload.amount || booking.pricing?.total || 0),
    currency: payload.currency || booking.pricing?.currency || 'UGX',
    status,
    paidAt: status === 'successful' ? new Date().toISOString() : null,
    idempotencyKey,
    rawPayload: payload,
    createdAt: new Date().toISOString(),
  };
  store.state.payments.push(payment);

  booking.paymentStatus = status;
  if (status === 'successful' && ['draft', 'pending'].includes(booking.bookingStatus)) booking.bookingStatus = 'confirmed';
  if (status === 'failed') {
    booking.bookingStatus = 'cancelled';
    booking.cancelReason = booking.cancelReason || 'Payment failed by provider webhook';
    booking.cancelledAt = booking.cancelledAt || new Date().toISOString();
    await releaseCancelledInventory(booking);
  }
  if (status === 'refunded') booking.bookingStatus = 'refunded';
  if (status === 'successful') store.settleBookingPayment(booking.bookingRef);

  await persistPaymentAndBooking(payment, booking);
  await persistWebhookEvent(payload, headers, { status: 'processed', signatureStatus: 'verified', processedAt: new Date() });
  await notificationService.paymentUpdated(booking, payment);
  await securityService.completeIdempotency(claim.record, { paymentId: payment.id, bookingRef: booking.bookingRef, status: payment.status });
  return { valid: true, processed: true, payment, booking };
}

module.exports = { processPaymentWebhook, signPayload, stableStringify, normalizeProviderPayload };

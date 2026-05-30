const crypto = require('crypto');
const store = require('../data/demoStore');
const notificationService = require('../notification/notificationService');
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

function assertValidSignature(payload, headers = {}) {
  const provided = headers['x-classic-trip-signature'] || headers['x-payment-signature'] || headers['X-Classic-Trip-Signature'];
  if (!provided) {
    const error = new Error('Missing payment webhook signature');
    error.status = 401;
    throw error;
  }
  const expected = signPayload(payload);
  if (!signaturesMatch(expected, provided)) {
    const error = new Error('Invalid payment webhook signature');
    error.status = 401;
    throw error;
  }
  return true;
}

function normalizedStatus(status = '') {
  const value = String(status || '').toLowerCase();
  if (['successful', 'success', 'paid', 'completed'].includes(value)) return 'successful';
  if (['failed', 'declined', 'cancelled'].includes(value)) return 'failed';
  if (['refunded', 'reversed'].includes(value)) return 'refunded';
  return value || 'pending';
}

async function persistPaymentAndBooking(payment, booking) {
  if (!mongoReady()) return;
  const Payment = require('../../models/Payment');
  const Booking = require('../../models/Booking');
  await Payment.updateOne(
    { idempotencyKey: payment.idempotencyKey },
    { $set: payment },
    { upsert: true, runValidators: true }
  );
  await Booking.updateOne(
    { bookingRef: booking.bookingRef },
    { $set: { paymentStatus: booking.paymentStatus, bookingStatus: booking.bookingStatus } }
  );
}

async function processPaymentWebhook(payload = {}, headers = {}) {
  assertValidSignature(payload, headers);
  const bookingRef = payload.bookingRef || payload.reference || payload.meta?.bookingRef;
  const booking = store.findBooking(bookingRef);
  if (!booking) {
    const error = new Error('Booking not found for payment webhook');
    error.status = 404;
    throw error;
  }

  if (!Array.isArray(store.state.payments)) store.state.payments = [];
  const status = normalizedStatus(payload.status);
  const idempotencyKey = payload.idempotencyKey || payload.eventId || payload.providerReference || `${payload.provider || 'mock'}:${booking.bookingRef}:${status}`;
  const existing = store.state.payments.find((payment) => payment.idempotencyKey === idempotencyKey);
  if (existing) return { valid: true, idempotent: true, payment: existing, booking };

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
  if (status === 'failed') booking.bookingStatus = 'cancelled';
  if (status === 'refunded') booking.bookingStatus = 'refunded';

  await persistPaymentAndBooking(payment, booking);
  await notificationService.paymentUpdated(booking, payment);
  return { valid: true, processed: true, payment, booking };
}

module.exports = { processPaymentWebhook, signPayload, stableStringify };

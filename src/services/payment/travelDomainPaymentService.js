'use strict';

const crypto = require('crypto');
const paymentService = require('./paymentService');
const flightRepo = require('../../modules/flight/repositories/flightRepository');
const taxiRepo = require('../../modules/taxi/repositories/taxiRepository');
const flightBookingService = require('../../modules/flight/services/flightBookingService');
const taxiRideService = require('../../modules/taxi/services/taxiRideService');
const { env } = require('../../config/env');
const { platformCurrency } = require('../../utils/currency');

function now() { return new Date(); }
function clean(value, max = 240) { return String(value || '').trim().slice(0, max); }

function safeEqual(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue || ''));
  const right = Buffer.from(String(rightValue || ''));
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function forbidden(message = 'This booking is not available for payment') {
  const error = new Error(message);
  error.status = 403;
  error.code = 'booking_payment_forbidden';
  return error;
}

function assertPaymentAccess(booking = {}, payload = {}, actor = {}) {
  if (actor.actorType === 'system' || ['super_admin', 'admin'].includes(actor.role)) return true;
  if (actor.accessGranted === true && String(actor.bookingRef || '') === String(booking.bookingRef || '')) return true;

  const companyId = clean(actor.companyId, 180);
  if (companyId) {
    const permittedCompanies = [booking.companyId, booking.agentCompanyId, booking.providerCompanyId]
      .filter(Boolean)
      .map(String);
    if (permittedCompanies.includes(companyId)) return true;
    throw forbidden();
  }

  const userId = clean(actor.userId || actor.id, 180);
  if (userId && userId !== 'guest' && String(booking.customerUserId || '') === userId) return true;

  const lookupCode = clean(payload.lookupCode || payload.accessCode, 180);
  if (lookupCode && safeEqual(lookupCode, booking.guestLookupCode || '')) return true;
  throw forbidden('A valid booking lookup code or matching customer account is required for payment');
}

function scopedIdempotencyKey(provider, bookingRef, supplied) {
  const requestKey = clean(supplied, 240);
  return requestKey
    ? `${provider}:${bookingRef}:${requestKey}`.slice(0, 500)
    : `${provider}:${bookingRef}:initiate`;
}

async function initiate(serviceType, bookingRef, payload = {}, actor = {}) {
  const type = String(serviceType || '').toLowerCase();
  const repo = type === 'flight' ? flightRepo : type === 'local_transport' ? taxiRepo : null;
  if (!repo) {
    const error = new Error('Unsupported travel payment service');
    error.status = 422;
    throw error;
  }

  const booking = await repo.oneOrThrow(
    repo.bookings,
    { bookingRef, serviceType: type },
    'Booking was not found',
  );
  assertPaymentAccess(booking, payload, actor);

  if (booking.paymentStatus === 'successful') {
    return {
      booking,
      payment: await repo.payments.findOne({ bookingId: booking.id, status: 'successful' }),
      alreadyPaid: true,
    };
  }
  if (['cancelled', 'failed', 'expired', 'refunded'].includes(String(booking.bookingStatus || ''))) {
    const error = new Error('This booking can no longer be paid');
    error.status = 409;
    throw error;
  }

  const provider = paymentService.resolveProviderName(payload.provider || payload.paymentProvider);
  const idempotencyKey = scopedIdempotencyKey(provider, booking.bookingRef, payload.idempotencyKey || actor.idempotencyKey);
  let intent = await repo.paymentIntents.findOne({ idempotencyKey });
  if (intent && String(intent.bookingId || '') !== String(booking.id)) {
    throw Object.assign(new Error('Payment idempotency key belongs to another booking'), { status: 409, code: 'payment_idempotency_conflict' });
  }
  if (intent?.checkoutUrl) {
    return {
      booking,
      intent,
      payment: await repo.payments.findOne({ bookingId: booking.id, providerReference: intent.providerReference }),
      checkoutUrl: intent.checkoutUrl,
      replayed: true,
    };
  }

  intent = intent || {
    id: await repo.nextId('payment-intent'),
    intentRef: `PI-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
    bookingId: booking.id,
    bookingRef: booking.bookingRef,
    companyId: booking.companyId,
    customerUserId: booking.customerUserId || '',
    provider,
    idempotencyKey,
    amount: Number(booking.pricing?.total || 0),
    currency: booking.pricing?.currency || platformCurrency(),
    status: 'created',
    expiresAt: booking.lockedUntil || new Date(Date.now() + 15 * 60 * 1000),
    attempts: [],
    metadata: { serviceType: type },
    createdAt: now(),
    updatedAt: now(),
  };
  await repo.paymentIntents.save(intent, { idempotencyKey });

  let result;
  try {
    result = await paymentService.initiatePayment({
      provider,
      bookingRef: booking.bookingRef,
      amount: intent.amount,
      currency: intent.currency,
      customer: booking.buyerSnapshot || booking.guestSnapshot || {},
      idempotencyKey,
      callbackUrl: `${env.appUrl}/booking/payment/callback?bookingRef=${encodeURIComponent(booking.bookingRef)}`,
      description: `Classic Trip ${type === 'flight' ? 'flight' : 'local ride'} booking ${booking.bookingRef}`,
      meta: { bookingId: booking.id, bookingRef: booking.bookingRef, serviceType: type },
    });
  } catch (error) {
    // A provider timeout or configuration failure is not a customer payment
    // decline. Keep the held booking retryable and record the failed attempt.
    intent.status = 'pending';
    intent.failedAt = null;
    intent.failureReason = clean(error.message, 1000);
    intent.attempts = [...(intent.attempts || []), {
      at: now(), provider, status: 'initiation_error', providerReference: '',
    }];
    intent.updatedAt = now();
    await repo.paymentIntents.save(intent, { idempotencyKey });
    throw error;
  }

  Object.assign(intent, {
      providerReference: result.providerReference || '',
      checkoutUrl: result.checkoutUrl || '',
      status: result.status || 'pending',
      paidAt: result.status === 'successful' ? (result.paidAt || now()) : null,
      attempts: [...(intent.attempts || []), {
        at: now(), provider, status: result.status || 'pending', providerReference: result.providerReference || '',
      }],
      updatedAt: now(),
  });
  await repo.paymentIntents.save(intent, { idempotencyKey });

  const payment = {
      id: await repo.nextId('payment'),
      bookingId: booking.id,
      bookingRef: booking.bookingRef,
      companyId: booking.companyId,
      customerUserId: booking.customerUserId || '',
      provider: result.provider || provider,
      providerReference: result.providerReference || `${booking.bookingRef}:pending`,
      paymentRef: result.providerReference || '',
      amount: intent.amount,
      grossAmount: intent.amount,
      currency: intent.currency,
      status: result.status || 'pending',
      settlementStatus: 'pending',
      paidAt: result.status === 'successful' ? (result.paidAt || now()) : null,
      checkoutUrl: result.checkoutUrl || '',
      idempotencyKey: `${provider}:${booking.bookingRef}:${result.providerReference || idempotencyKey}`.slice(0, 500),
      rawPayload: result.rawPayload || result,
      metadata: { source: 'travelDomainPaymentService', paymentIntentId: intent.id, serviceType: type },
      createdAt: now(),
      updatedAt: now(),
  };
  Object.assign(booking, {
      paymentProvider: payment.provider,
      paymentRef: payment.providerReference,
      checkoutUrl: payment.checkoutUrl,
      paymentStatus: payment.status,
      updatedAt: now(),
  });
  await repo.withTransaction(async (session) => {
    const options = session ? { session } : {};
    await repo.bookings.save(booking, { id: booking.id }, options);
    await repo.payments.save(payment, { idempotencyKey: payment.idempotencyKey }, options);
  });

  let processed = booking;
  if (payment.status === 'successful') {
    processed = type === 'flight'
      ? await flightBookingService.confirmPayment(booking.bookingRef, {
        provider: payment.provider, providerReference: payment.providerReference, paymentId: payment.id, source: 'payment_initiation',
      })
      : await taxiRideService.confirmPayment(booking.bookingRef, {
        provider: payment.provider, providerReference: payment.providerReference, paymentId: payment.id, source: 'payment_initiation',
      });
  }
  if (payment.status === 'failed') {
    processed = type === 'flight'
      ? await flightBookingService.failPayment(booking.bookingRef, 'Payment provider declined the payment', payment)
      : await taxiRideService.failPayment(booking.bookingRef, 'Payment provider declined the payment', payment);
  }
  return { booking: processed, payment, intent, checkoutUrl: payment.checkoutUrl };
}

module.exports = { initiate, assertPaymentAccess, scopedIdempotencyKey };

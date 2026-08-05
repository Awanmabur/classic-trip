'use strict';

const crypto = require('crypto');
const commerceRepository = require('../../repositories/domain/commerceRepository');
const hotelRepository = require('../../repositories/domain/hotelRepository');
const paymentService = require('./paymentService');
const travelPaymentService = require('./travelDomainPaymentService');
const busBookingService = require('../../modules/bus/services/busBookingService');
const bookingService = require('../booking/bookingService');
const paymentSettlementService = require('../booking/paymentSettlementService');
const notificationService = require('../notification/notificationService');
const { nextId } = require('../data/idService');
const { env } = require('../../config/env');
const { canonicalRole } = require('../../config/accessControl');
const { platformCurrency } = require('../../utils/currency');

function clean(value, max = 300) { return String(value || '').trim().slice(0, max); }
function now() { return new Date().toISOString(); }

function assertBookingOwner(booking = {}, actor = {}) {
  const role = canonicalRole(actor.role);
  if (['super_admin', 'admin', 'finance_admin', 'support_admin'].includes(role)) return true;
  if (actor.accessGranted === true && String(actor.bookingRef || '') === String(booking.bookingRef || '')) return true;
  if (actor.companyId && String(actor.companyId) === String(booking.companyId || '')) return true;
  if (actor.id && String(actor.id) === String(booking.customerUserId || '')) return true;
  throw Object.assign(new Error('This booking is not available for payment from your account'), {
    status: 403,
    code: 'booking_payment_forbidden',
  });
}

function scopedIdempotencyKey(provider, bookingRef, supplied = '') {
  const requestKey = clean(supplied, 240) || crypto.randomBytes(12).toString('hex');
  return `${provider}:${bookingRef}:${requestKey}`.slice(0, 500);
}

function applyHotelLifecycle(booking, status) {
  const normalized = String(status || 'pending').toLowerCase();
  const successful = normalized === 'successful';
  const terminalFailure = ['failed', 'expired', 'cancelled'].includes(normalized);
  booking.paymentStatus = successful ? 'successful' : terminalFailure ? (normalized === 'expired' ? 'expired' : 'failed') : 'pending';
  booking.bookingStatus = successful ? 'confirmed' : terminalFailure ? (normalized === 'expired' ? 'expired' : 'failed') : 'pending_payment';
  booking.settlementStatus = successful ? 'pending_fulfillment' : 'pending_payment';
  booking.lockedUntil = successful || terminalFailure ? null : booking.lockedUntil;
  booking.hotelStay = { ...(booking.hotelStay || {}), status: successful ? 'booked' : terminalFailure ? booking.bookingStatus : 'pending_payment' };
  booking.bookingItems = (booking.bookingItems || []).map((item) => ({
    ...item,
    status: successful ? 'confirmed' : terminalFailure ? booking.bookingStatus : 'awaiting_payment',
  }));
  booking.ticketLegs = (booking.ticketLegs || []).map((leg) => ({
    ...leg,
    status: successful ? 'valid' : terminalFailure ? 'cancelled' : 'pending_payment',
    issuedAt: successful ? (leg.issuedAt || now()) : leg.issuedAt,
    ...(terminalFailure ? { cancelledAt: leg.cancelledAt || now() } : {}),
  }));
}

async function persistResult(booking, intent, payment) {
  const serviceType = String(booking.serviceType || '').toLowerCase();
  if (payment.status !== 'failed') {
    booking.paymentProvider = payment.provider;
    booking.paymentRef = payment.providerReference;
    booking.checkoutUrl = payment.checkoutUrl || '';
  }
  if (payment.status === 'pending') booking.paymentStatus = 'pending';
  booking.updatedAt = now();

  if (serviceType === 'hotel') applyHotelLifecycle(booking, payment.status);
  if (['tour', 'car_rental', 'cargo'].includes(serviceType)) {
    if (payment.status === 'successful') {
      booking.paymentStatus = 'successful';
      booking.bookingStatus = 'confirmed';
      booking.settlementStatus = 'pending_fulfillment';
      booking.lockedUntil = null;
      booking.bookingItems = (booking.bookingItems || []).map((item) => ({ ...item, status: 'confirmed' }));
    } else if (payment.status === 'pending') {
      booking.paymentStatus = 'pending';
      booking.bookingStatus = 'pending_payment';
    }
  }

  await commerceRepository.withTransaction(async (session) => {
    await commerceRepository.paymentIntents.save(intent, { idempotencyKey: intent.idempotencyKey }, { session });
    await commerceRepository.payments.save(payment, { idempotencyKey: payment.idempotencyKey }, { session });
    await commerceRepository.bookings.save(booking, { bookingRef: booking.bookingRef }, { session });
    if (serviceType === 'hotel') {
      const lifecycle = await hotelRepository.applyPaymentLifecycle({
        bookingRef: booking.bookingRef,
        companyId: booking.companyId,
        paymentStatus: payment.status,
        reason: `Payment changed to ${payment.status} through the canonical retry endpoint`,
        session,
      });
      if (!lifecycle?.reservation) {
        throw Object.assign(new Error('Hotel booking has no canonical reservation'), {
          status: 409,
          code: 'hotel_reconciliation_required',
        });
      }
    }
  });
}

async function initiate(bookingRef, payload = {}, actor = {}) {
  const booking = await commerceRepository.bookings.findOne({ bookingRef: clean(bookingRef, 180) });
  if (!booking) throw Object.assign(new Error('Booking was not found'), { status: 404 });
  assertBookingOwner(booking, actor);

  const serviceType = String(booking.serviceType || '').toLowerCase();
  if (['flight', 'local_transport'].includes(serviceType)) {
    return travelPaymentService.initiate(serviceType, booking.bookingRef, payload, {
      ...actor,
      userId: actor.id,
      actorType: actor.actorType || 'customer',
    });
  }
  if (booking.paymentStatus === 'successful') {
    return {
      booking,
      payment: await commerceRepository.payments.findOne({ bookingId: booking.id, status: 'successful' }),
      alreadyPaid: true,
    };
  }
  if (['cancelled', 'failed', 'expired', 'refunded', 'completed'].includes(String(booking.bookingStatus || '').toLowerCase())) {
    throw Object.assign(new Error('This booking can no longer be paid'), { status: 409 });
  }

  const provider = paymentService.resolveProviderName(payload.provider || payload.paymentProvider || env.paymentProvider);
  const suppliedIdempotency = payload.idempotencyKey || actor.idempotencyKey || '';
  const idempotencyKey = scopedIdempotencyKey(provider, booking.bookingRef, suppliedIdempotency || 'retry');
  let intent = await commerceRepository.paymentIntents.findOne({ idempotencyKey });
  if (intent && String(intent.bookingId || '') !== String(booking.id)) {
    throw Object.assign(new Error('Payment idempotency key belongs to another booking'), { status: 409, code: 'payment_idempotency_conflict' });
  }
  if (intent?.checkoutUrl && ['created', 'pending', 'processing'].includes(String(intent.status || '').toLowerCase())) {
    return {
      booking,
      intent,
      payment: await commerceRepository.payments.findOne({ bookingId: booking.id, providerReference: intent.providerReference }),
      checkoutUrl: intent.checkoutUrl,
      replayed: true,
    };
  }

  const amount = Number(booking.pricing?.total || booking.grossAmount || 0);
  const currency = String(booking.pricing?.currency || platformCurrency()).toUpperCase();
  if (!(amount > 0)) throw Object.assign(new Error('Booking total is invalid'), { status: 409, code: 'booking_total_invalid' });

  intent = intent || {
    id: await nextId('payment-intent'),
    intentRef: `PI-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
    bookingId: booking.id,
    bookingRef: booking.bookingRef,
    companyId: booking.companyId,
    customerUserId: booking.customerUserId || '',
    provider,
    idempotencyKey,
    amount,
    currency,
    status: 'created',
    expiresAt: booking.lockedUntil || new Date(Date.now() + 15 * 60 * 1000),
    attempts: [],
    metadata: { serviceType, source: 'bookingPaymentService' },
    createdAt: now(),
  };
  await commerceRepository.paymentIntents.save(intent, { idempotencyKey });

  let result;
  try {
    result = await paymentService.initiatePayment({
      provider,
      bookingRef: booking.bookingRef,
      amount,
      currency,
      customer: booking.buyerSnapshot || booking.guestSnapshot || {},
      idempotencyKey,
      callbackUrl: `${env.appUrl}/booking/payment/callback?bookingRef=${encodeURIComponent(booking.bookingRef)}`,
      description: `Classic Trip ${serviceType} booking ${booking.bookingRef}`,
      meta: { bookingId: booking.id, bookingRef: booking.bookingRef, serviceType },
    });
  } catch (error) {
    Object.assign(intent, {
      status: 'pending',
      failedAt: null,
      failureReason: clean(error.message, 1000),
      attempts: [...(intent.attempts || []), { at: now(), provider, status: 'initiation_error', providerReference: '' }],
      updatedAt: now(),
    });
    await commerceRepository.paymentIntents.save(intent, { idempotencyKey });
    throw error;
  }

  const status = String(result.status || 'pending').toLowerCase() === 'successful' ? 'successful'
    : String(result.status || '').toLowerCase() === 'failed' ? 'failed' : 'pending';
  Object.assign(intent, {
    providerReference: result.providerReference || '',
    checkoutUrl: result.checkoutUrl || '',
    status,
    paidAt: status === 'successful' ? (result.paidAt || now()) : null,
    attempts: [...(intent.attempts || []), { at: now(), provider, status, providerReference: result.providerReference || '' }],
    updatedAt: now(),
  });
  const payment = {
    id: await nextId('payment'),
    bookingId: booking.id,
    bookingRef: booking.bookingRef,
    companyId: booking.companyId,
    customerUserId: booking.customerUserId || '',
    provider: result.provider || provider,
    providerReference: result.providerReference || `${booking.bookingRef}:pending`,
    paymentRef: result.providerReference || '',
    amount,
    grossAmount: amount,
    currency,
    status,
    settlementStatus: 'pending',
    paidAt: status === 'successful' ? (result.paidAt || now()) : null,
    checkoutUrl: result.checkoutUrl || '',
    idempotencyKey: `${provider}:${booking.bookingRef}:${result.providerReference || idempotencyKey}`.slice(0, 500),
    rawPayload: result.rawPayload || result,
    metadata: { source: 'bookingPaymentService', paymentIntentId: intent.id, serviceType },
    createdAt: now(),
    updatedAt: now(),
  };
  await persistResult(booking, intent, payment);

  let processedBooking = booking;
  if (status === 'successful' && serviceType === 'bus') {
    processedBooking = await busBookingService.confirmPayment(booking.bookingRef, {
      provider: payment.provider,
      providerReference: payment.providerReference,
      paymentId: payment.id,
      source: 'payment_retry',
    });
  } else if (status === 'failed' && serviceType === 'bus') {
    processedBooking = await busBookingService.failPayment(booking.bookingRef, 'Payment provider declined the payment', {
      provider: payment.provider,
      providerReference: payment.providerReference,
      source: 'payment_retry',
    });
  } else if (status === 'failed' && ['tour', 'car_rental', 'cargo'].includes(serviceType)) {
    await bookingService.purgeFailedBookingArtifacts(booking, {}, 'Payment provider declined the payment');
    processedBooking = null;
  } else if (status === 'successful' && ['hotel', 'tour', 'car_rental', 'cargo'].includes(serviceType)) {
    try {
      Object.assign(processedBooking, await paymentSettlementService.settleBookingPayment(processedBooking, { source: 'payment_retry' }) || {});
      await commerceRepository.bookings.save(processedBooking, { bookingRef: processedBooking.bookingRef });
    } catch (error) {
      processedBooking.settlementStatus = 'reconciliation_required';
      processedBooking.settlementError = clean(error.message, 1000);
      await commerceRepository.bookings.save(processedBooking, { bookingRef: processedBooking.bookingRef });
    }
    await notificationService.bookingConfirmed(processedBooking);
  }
  await notificationService.paymentUpdated(processedBooking || booking, payment);
  return { booking: processedBooking, payment, intent, checkoutUrl: payment.checkoutUrl };
}

module.exports = { initiate, assertBookingOwner, scopedIdempotencyKey };

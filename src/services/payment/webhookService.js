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
  const row = {
    id: `webhook-${crypto.createHash('sha1').update(`${payload.provider || ''}:${idempotencyKey}`).digest('hex').slice(0, 16)}`,
    provider: payload.provider || env.paymentProvider, providerReference: payload.providerReference || payload.reference || '',
    bookingRef: payload.bookingRef || payload.reference || payload.meta?.bookingRef || '', idempotencyKey,
    status: 'received', signatureStatus: 'unchecked', amount: Number(payload.amount || 0), currency: payload.currency || platformCurrency(),
    eventType: payload.event || payload.type || payload.status || '', rawPayload: payload.originalPayload || payload, rawBodyHash: rawBodyHash(headers), ...patch,
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

function normalizeProviderPayload(payload = {}) {
  const data = payload.data || payload.event || payload.transaction || {};
  const meta = payload.meta || payload.metadata || data.meta || data.metadata || data.customer || {};
  const hasPesapalShape = Boolean(payload.OrderTrackingId || payload.order_tracking_id || payload.orderTrackingId || data.OrderTrackingId || data.order_tracking_id || payload.OrderMerchantReference || payload.order_merchant_reference || payload.merchant_reference);
  const provider = pickFirst(payload.provider, data.provider, payload.source, hasPesapalShape ? 'pesapal' : env.paymentProvider);
  return {
    ...payload,
    provider,
    bookingRef: pickFirst(payload.bookingRef, payload.orderRef, payload.OrderMerchantReference, payload.order_merchant_reference, payload.merchant_reference, data.bookingRef, data.orderRef, data.OrderMerchantReference, data.order_merchant_reference, data.merchant_reference, meta.bookingRef, meta.booking_ref, meta.custom_fields?.bookingRef, meta.custom_fields?.booking_ref, payload.tx_ref, payload.trxref, data.tx_ref, data.trxref, payload.reference, data.reference),
    providerReference: pickFirst(payload.providerReference, payload.OrderTrackingId, payload.order_tracking_id, payload.orderTrackingId, payload.transaction_id, payload.flw_ref, payload.reference, payload.tx_ref, data.providerReference, data.OrderTrackingId, data.order_tracking_id, data.orderTrackingId, data.id, data.reference, data.flw_ref, data.tx_ref),
    amount: Number(pickFirst(payload.amount, payload.payment_amount, data.amount, data.payment_amount, data.charged_amount, data.requested_amount, meta.amount, 0)),
    currency: String(pickFirst(payload.currency, payload.currency_code, data.currency, data.currency_code, meta.currency, platformCurrency())).toUpperCase(),
    status: normalizedStatus(pickFirst(payload.status, payload.payment_status_description, payload.paymentStatusDescription, data.status, data.payment_status_description, data.paymentStatusDescription, payload.event_type, data.gateway_response)),
    idempotencyKey: pickFirst(payload.idempotencyKey, payload.eventId, payload.event_id, payload.providerReference, payload.OrderTrackingId, payload.order_tracking_id, data.id, data.reference, data.OrderTrackingId, data.order_tracking_id, payload.reference),
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
    const intent = await commerceRepository.paymentIntents.findOne({ bookingRef: intentRef, provider: payment.provider }, { session });
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
  if (receivedAmount && expectedAmount && Math.abs(receivedAmount - expectedAmount) > 0.0001) { const error = new Error(`Payment webhook amount does not match the ${entityType}`); error.status = 409; error.code = 'PAYMENT_AMOUNT_MISMATCH'; throw error; }
  if (receivedCurrency !== expectedCurrency) { const error = new Error(`Payment webhook currency does not match the ${entityType}`); error.status = 409; error.code = 'PAYMENT_CURRENCY_MISMATCH'; throw error; }
}
async function processBookingGroupWebhook(payload, headers, group) {
  const bookings = await loadBookingsForGroup(group);
  if (!bookings.length) { const error = new Error('Booking group has no child bookings'); error.status = 409; throw error; }
  assertAmountAndCurrency(group, payload, 'booking group');
  const status = normalizedStatus(payload.status); const idempotencyKey = payload.idempotencyKey || payload.eventId || payload.providerReference || `${payload.provider || env.paymentProvider}:${group.groupRef}:${status}`;
  const claim = await securityService.claimIdempotencyKey({ key: idempotencyKey, scope: 'payment_webhook', entityType: 'booking_group', entityId: group.id, payload, metadata: { provider: payload.provider || env.paymentProvider, bookingGroupRef: group.groupRef } });
  const existing = await commerceRepository.payments.findOne({ idempotencyKey });
  if ((claim.replayed || existing) && status !== 'failed') return { valid: true, idempotent: true, payment: existing, bookingGroup: group, bookings };
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
  const payment = { id: await nextId('payment'), bookingId: group.id, bookingRef: group.groupRef, provider: payload.provider || env.paymentProvider, providerReference: payload.providerReference || payload.reference || idempotencyKey, amount: Number(payload.amount || group.pricing?.total || 0), grossAmount: Number(payload.amount || group.pricing?.total || 0), currency: payload.currency || group.pricing?.currency || platformCurrency(), status, paidAt: status === 'successful' ? new Date().toISOString() : null, idempotencyKey, rawPayload: payload, metadata: { bookingGroupRef: group.groupRef, childBookingRefs: group.bookingRefs || [] }, createdAt: new Date().toISOString() };
  Object.assign(group, { paymentId: payment.id, paymentRef: payment.providerReference, paymentProvider: payment.provider, paymentStatus: status, status: status === 'successful' ? 'confirmed' : status === 'failed' ? 'cancelled' : status === 'refunded' ? 'refunded' : 'pending_payment' });
  for (const booking of bookings) {
    if (String(booking.serviceType || '').toLowerCase() === 'bus') continue;
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
        payload = { ...payload, bookingRef: providerVerification.bookingRef || payload.bookingRef, providerReference: providerVerification.providerReference || payload.providerReference, amount: providerVerification.amount || payload.amount, currency: providerVerification.currency || payload.currency, status: providerVerification.status || payload.status, providerVerified: true, originalPayload, providerVerificationPayload: providerVerification.payload };
      }
    }
    if (!providerVerification?.valid) assertValidSignature(payload, headers);
    await persistWebhookEvent(payload, headers, { signatureStatus: providerVerification?.valid ? 'verified_provider_status' : 'verified' });
  } catch (error) {
    await persistWebhookEvent(payload, headers, { status: 'blocked', signatureStatus: 'failed', failureReason: error.message });
    await securityService.recordSecurityEvent({ eventType: 'payment_webhook_signature_failed', severity: 'high', entityType: 'payment_webhook', status: 'blocked', reason: error.message, metadata: { provider: payload.provider || '', providerReference: payload.providerReference || payload.reference || '', payload } });
    throw error;
  }

  const bookingRef = payload.bookingRef || payload.reference || payload.meta?.bookingRef;
  const booking = await loadBookingForWebhook(bookingRef);
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

  try { assertAmountAndCurrency(booking, payload, 'booking'); }
  catch (error) {
    await securityService.recordSecurityEvent({ eventType: error.code === 'PAYMENT_CURRENCY_MISMATCH' ? 'payment_webhook_currency_mismatch' : 'payment_webhook_amount_mismatch', severity: 'critical', entityType: 'booking', entityId: booking.id, status: 'blocked', reason: error.message, metadata: { bookingRef: booking.bookingRef, provider: payload.provider || '', providerReference: payload.providerReference || payload.reference || '', amount: payload.amount, currency: payload.currency } });
    throw error;
  }

  const status = normalizedStatus(payload.status);
  const idempotencyKey = payload.idempotencyKey || payload.eventId || payload.providerReference || `${payload.provider || env.paymentProvider}:${booking.bookingRef}:${status}`;
  const claim = await securityService.claimIdempotencyKey({ key: idempotencyKey, scope: 'payment_webhook', entityType: 'booking', entityId: booking.id, payload, metadata: { provider: payload.provider || env.paymentProvider, bookingRef: booking.bookingRef } });
  const existing = await commerceRepository.payments.findOne({ idempotencyKey });
  if ((claim.replayed || existing) && status !== 'failed') {
    if (existing && claim.record.status !== 'completed') await securityService.completeIdempotency(claim.record, { paymentId: existing.id, bookingRef: booking.bookingRef, status: existing.status });
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
    id: await nextId('payment'), bookingId: booking.id, bookingRef: booking.bookingRef, companyId: booking.companyId, customerUserId: booking.customerUserId || '',
    provider: payload.provider || env.paymentProvider, providerReference: payload.providerReference || payload.reference || idempotencyKey,
    amount: Number(payload.amount || booking.pricing?.total || 0), grossAmount: Number(payload.amount || booking.pricing?.total || 0), currency: payload.currency || booking.pricing?.currency || platformCurrency(),
    status, paidAt: status === 'successful' ? new Date().toISOString() : null, idempotencyKey, rawPayload: payload, createdAt: new Date().toISOString(),
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
  } else {
    Object.assign(booking, { paymentStatus: status, paymentProvider: payment.provider, paymentRef: payment.providerReference, updatedAt: new Date().toISOString() });
    applyHotelPaymentLifecycle(booking, status);
    if (String(booking.serviceType || '').toLowerCase() !== 'hotel') {
      if (status === 'successful' && ['draft', 'pending', 'pending_payment'].includes(booking.bookingStatus)) booking.bookingStatus = 'confirmed';
      if (status === 'refunded') booking.bookingStatus = 'refunded';
    }
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

module.exports = { processPaymentWebhook, signPayload, stableStringify, normalizeProviderPayload };

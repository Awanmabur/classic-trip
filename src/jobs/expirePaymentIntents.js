const commerceRepository = require('../repositories/domain/commerceRepository');
const hotelRepository = require('../repositories/domain/hotelRepository');
const inventoryHoldService = require('../services/booking/inventoryHoldService');

const EXPIRABLE_INTENT_STATUSES = ['created', 'pending', 'processing'];
const NON_CANCELLABLE_BOOKING_STATUSES = ['confirmed', 'checked_in', 'completed', 'refunded'];

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function ticketLegsCancelled(legs = [], now = new Date().toISOString()) {
  return (legs || []).map((leg) => ({
    ...leg,
    status: ['valid', 'reserved', 'pending', 'pending_payment'].includes(normalize(leg.status)) ? 'cancelled' : leg.status,
    checkInStatus: 'cancelled',
    cancelledAt: leg.cancelledAt || now,
  }));
}

async function refreshScheduleAvailability(scheduleId, session = null) {
  if (!scheduleId) return null;
  const availableSeats = await commerceRepository.seats.count({ scheduleId, status: 'available' }, { session: session || undefined });
  await commerceRepository.schedules.updateOne(
    { id: scheduleId },
    { $set: { availableSeats, updatedAt: new Date().toISOString() } },
    { session: session || undefined }
  );
  return availableSeats;
}

async function releaseBusInventory(booking, session = null) {
  const claims = [...new Map((booking.bookingItems || [])
    .filter((item) => item.scheduleId && item.seatNumber)
    .map((item) => [`${item.scheduleId}:${String(item.seatNumber).toUpperCase()}`, item])).values()];
  let released = 0;
  for (const claim of claims) {
    const result = await commerceRepository.seats.updateOne({
      scheduleId: claim.scheduleId,
      seatNumber: claim.seatNumber,
      bookingRef: booking.bookingRef,
      status: { $in: ['taken', 'booked', 'reserved', 'held', 'selected', 'locked'] },
    }, {
      $set: { status: 'available', updatedAt: new Date().toISOString() },
      $unset: {
        bookingRef: '', bookingId: '', lockedUntil: '', lockId: '',
        passengerName: '', passengerPhone: '', passengerEmail: '',
      },
    }, { session: session || undefined });
    released += Number(result?.modifiedCount ?? result?.nModified ?? 0);
  }
  for (const scheduleId of [...new Set(claims.map((item) => item.scheduleId))]) {
    await refreshScheduleAvailability(scheduleId, session);
  }
  return released;
}

async function releaseHotelInventory(booking, session = null, reason = 'payment_intent_expired') {
  const result = await hotelRepository.applyPaymentLifecycle({
    bookingRef: booking.bookingRef,
    companyId: booking.companyId || '',
    paymentStatus: 'expired',
    reason,
    session,
  });
  if (result?.reservation) return { roomNights: Number(result.inventoryReleased || 0), rooms: 0 };

  const nights = await commerceRepository.roomNights.list({ bookingRef: booking.bookingRef }, { session: session || undefined });
  let roomNights = 0;
  for (const night of nights) {
    if (['occupied', 'checked_in', 'checked_out', 'cleaning', 'maintenance'].includes(normalize(night.status))) continue;
    const released = await commerceRepository.roomNights.updateOne({ id: night.id, bookingRef: booking.bookingRef }, {
      $set: { status: 'available', bookingRef: '', reservationId: '', assignmentId: '', guestName: '', checkInStatus: '', availableInventory: 1, updatedAt: new Date().toISOString() },
      $unset: { holdId: '' },
    }, { session: session || undefined });
    roomNights += Number(released?.modifiedCount ?? released?.nModified ?? 0);
  }
  return { roomNights, rooms: 0 };
}

async function releaseBookingInventoryInSession(booking = {}, reason = 'payment_intent_expired', session = null) {
  if (!booking?.bookingRef) return { booking: null, seats: 0, roomNights: 0, rooms: 0 };
  const now = new Date().toISOString();
  let seats = 0;
  let roomNights = 0;
  let rooms = 0;

  if (normalize(booking.serviceType) === 'bus') seats = await releaseBusInventory(booking, session);
  if (normalize(booking.serviceType) === 'hotel') {
    const released = await releaseHotelInventory(booking, session, reason);
    roomNights = released.roomNights;
    rooms = released.rooms;
  }

  const hotelBooking = normalize(booking.serviceType) === 'hotel';
  const cancelled = {
    ...booking,
    bookingStatus: hotelBooking ? 'expired' : 'cancelled',
    paymentStatus: booking.paymentStatus === 'successful' ? 'successful' : 'expired',
    cancelReason: booking.cancelReason || reason,
    cancelledAt: booking.cancelledAt || now,
    ticketLegs: ticketLegsCancelled(booking.ticketLegs, now),
    bookingItems: (booking.bookingItems || []).map((item) => ({ ...item, status: ['confirmed', 'awaiting_payment', 'reserved'].includes(normalize(item.status)) ? 'cancelled' : item.status })),
    hotelStay: hotelBooking ? { ...(booking.hotelStay || {}), status: 'expired' } : booking.hotelStay,
    lockedUntil: null,
    updatedAt: now,
  };
  await commerceRepository.bookings.save(cancelled, { bookingRef: cancelled.bookingRef }, {
    session: session || undefined,
  });
  return { booking: cancelled, seats, roomNights, rooms };
}

async function releaseBookingInventory(booking = {}, reason = 'payment_intent_expired') {
  let result;
  await commerceRepository.withTransaction(async (session) => {
    result = await releaseBookingInventoryInSession(booking, reason, session);
  });
  return result || { booking: null, seats: 0, roomNights: 0, rooms: 0 };
}

async function expireIntent(intent, now = new Date()) {
  let outcome = { expired: false, cancelled: false, seats: 0, roomNights: 0, rooms: 0 };
  let expiredIntent = null;
  let cancelledBooking = null;

  await commerceRepository.withTransaction(async (session) => {
    const current = await commerceRepository.paymentIntents.findOne(
      intent.id ? { id: intent.id } : { idempotencyKey: intent.idempotencyKey },
      { session: session || undefined }
    );
    if (!current || !EXPIRABLE_INTENT_STATUSES.includes(normalize(current.status))) return;
    if (!current.expiresAt || new Date(current.expiresAt) > now) return;

    const update = {
      status: 'expired',
      failedAt: now.toISOString(),
      failureReason: 'Payment intent expired before confirmation',
      updatedAt: now.toISOString(),
    };
    const updateResult = await commerceRepository.paymentIntents.updateOne({
      ...(current.id ? { id: current.id } : { idempotencyKey: current.idempotencyKey }),
      status: { $in: EXPIRABLE_INTENT_STATUSES },
      expiresAt: { $lte: now },
    }, { $set: update }, { session: session || undefined });
    if (Number(updateResult?.matchedCount ?? updateResult?.n ?? 0) !== 1) return;
    expiredIntent = { ...current, ...update };
    outcome.expired = true;

    const booking = current.bookingRef
      ? await commerceRepository.bookings.findOne({ bookingRef: current.bookingRef }, { session: session || undefined })
      : null;
    if (!booking || NON_CANCELLABLE_BOOKING_STATUSES.includes(normalize(booking.bookingStatus))) return;
    const released = await releaseBookingInventoryInSession(booking, 'payment_intent_expired', session);
    cancelledBooking = released.booking;
    outcome = {
      ...outcome,
      cancelled: Boolean(released.booking),
      seats: released.seats,
      roomNights: released.roomNights,
      rooms: released.rooms,
    };
  });
  return outcome;
}

async function run() {
  const now = new Date();
  const result = {
    expiredIntents: 0,
    cancelledBookings: 0,
    seatsReleased: 0,
    roomNightsReleased: 0,
    roomsReleased: 0,
    holdsExpired: await inventoryHoldService.expireActiveHolds(),
  };
  const intents = await commerceRepository.paymentIntents.list({
    status: { $in: EXPIRABLE_INTENT_STATUSES },
    expiresAt: { $lte: now },
  }, { sort: { expiresAt: 1, createdAt: 1 } });

  for (const intent of intents) {
    const expired = await expireIntent(intent, now);
    if (!expired.expired) continue;
    result.expiredIntents += 1;
    if (expired.cancelled) result.cancelledBookings += 1;
    result.seatsReleased += expired.seats;
    result.roomNightsReleased += expired.roomNights;
    result.roomsReleased += expired.rooms;
  }
  return result;
}

module.exports = { run, expireIntent, releaseBookingInventory };

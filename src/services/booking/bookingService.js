const store = require('../data/persistentStore');
const { mongoose } = require('../../config/db');
const { env } = require('../../config/env');
const inventoryHoldService = require('./inventoryHoldService');
const ticketScanService = require('../qr/ticketScanService');
const timelineService = require('../support/timelineService');

function mongoReady() {
  return mongoose.connection.readyState === 1;
}

async function persistPaymentIntent(intent = {}) {
  if (!mongoReady()) return;
  const PaymentIntent = require('../../models/PaymentIntent');
  await PaymentIntent.updateOne(
    { idempotencyKey: intent.idempotencyKey || intent.id },
    { $set: intent },
    { upsert: true, runValidators: true }
  );
}

function isStandaloneTransactionError(error = {}) {
  const message = String(error.message || error.errmsg || '').toLowerCase();
  return message.includes('transaction numbers are only allowed on a replica set member or mongos')
    || message.includes('transaction numbers are only allowed')
    || message.includes('replica set member or mongos')
    || error.code === 20
    || error.codeName === 'IllegalOperation';
}

async function runMongoUnitOfWork(work) {
  if (!mongoReady()) return work(null);
  if (!env.mongoTransactions) {
    // Local MongoDB usually runs as a standalone server. Atomic findOneAndUpdate
    // operations still protect seats/rooms, but multi-document transactions require
    // Atlas, mongos, or a replica set.
    return work(null);
  }
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    }, {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
    });
    return result;
  } catch (error) {
    if (isStandaloneTransactionError(error)) {
      return work(null);
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

function sessionOptions(session, extra = {}) {
  return session ? { ...extra, session } : extra;
}

async function recordBookingTimeline(booking = {}, action, title, message = '', meta = {}) {
  if (!booking || !booking.bookingRef) return null;
  try {
    return await timelineService.recordEvent({
      bookingRef: booking.bookingRef,
      bookingId: booking.id,
      companyId: booking.companyId,
      customerUserId: booking.customerUserId || '',
      entityType: meta.entityType || 'booking',
      entityId: meta.entityId || booking.id || booking.bookingRef,
      action,
      title,
      message,
      status: meta.status || booking.bookingStatus || booking.paymentStatus || 'open',
      actorType: meta.actorType || 'system',
      actorId: meta.actorId || 'booking-service',
      actorName: meta.actorName || 'Classic Trip',
      visibility: meta.visibility || 'shared',
      metadata: { serviceType: booking.serviceType, scheduleId: booking.scheduleId || '', ...(meta.metadata || {}) },
    });
  } catch (error) {
    return null;
  }
}

function isoDate(value, fallback = new Date()) {
  const date = value ? new Date(value) : new Date(fallback);
  if (Number.isNaN(date.getTime())) {
    const error = new Error('Invalid hotel date');
    error.status = 422;
    throw error;
  }
  return date.toISOString().slice(0, 10);
}

function hotelNightRange(payload = {}, booking = {}) {
  const checkIn = isoDate(payload.checkInDate || payload.checkIn || payload.startDate || booking.hotelStay?.checkIn || booking.bookingItems?.[0]?.checkIn);
  const checkOutSeed = payload.checkOutDate || payload.checkOut || payload.endDate || booking.hotelStay?.checkOut || booking.bookingItems?.[0]?.checkOut;
  const fallbackOut = new Date(`${checkIn}T00:00:00.000Z`);
  fallbackOut.setUTCDate(fallbackOut.getUTCDate() + Math.max(1, Number(payload.nights || 1)));
  const checkOut = isoDate(checkOutSeed || fallbackOut);
  const start = new Date(`${checkIn}T00:00:00.000Z`);
  const end = new Date(`${checkOut}T00:00:00.000Z`);
  if (!(end > start)) {
    const error = new Error('Hotel check-out must be after check-in');
    error.status = 422;
    throw error;
  }
  const nights = [];
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) nights.push(d.toISOString().slice(0, 10));
  return { checkIn, checkOut, nights };
}

function reusableSeatFilter(scheduleId, seatNumber, holdId = '', now = new Date()) {
  const reusable = [
    { status: 'available' },
    { status: 'locked', lockedUntil: { $lte: now } },
    // Older local builds did not persist bookingRef on Seat, so failed or test checkouts
    // could leave seats stuck as taken forever. Reclaim only unowned taken seats.
    { status: 'taken', $or: [{ bookingRef: { $exists: false } }, { bookingRef: '' }, { bookingRef: null }] },
  ];
  if (holdId) reusable.push({ status: 'locked', lockId: holdId, lockedUntil: { $gt: now } });
  return { scheduleId, seatNumber, $or: reusable };
}

async function refreshScheduleAvailability(scheduleId, session = null) {
  if (!scheduleId || !mongoReady()) return;
  const Seat = require('../../models/Seat');
  const TripSchedule = require('../../models/TripSchedule');
  const availableSeats = await Seat.countDocuments({ scheduleId, status: 'available' }).session(session || null);
  await TripSchedule.updateOne({ id: scheduleId }, { $set: { availableSeats } }, sessionOptions(session));
}

async function claimBusSeatsAtomically(booking = {}, payload = {}, session = null) {
  const seatClaims = (booking.bookingItems || [])
    .filter((item) => item.scheduleId && item.seatNumber)
    .map((item) => ({ scheduleId: item.scheduleId, seatNumber: item.seatNumber, legType: item.legType, passenger: item.passenger || item }));
  if (!mongoReady() || !seatClaims.length) return;
  const Seat = require('../../models/Seat');
  const now = new Date();
  const holdId = payload.holdId || booking.holdId || '';
  const failures = [];
  for (const claim of seatClaims) {
    const passenger = claim.passenger || {};
    const updated = await Seat.findOneAndUpdate(
      reusableSeatFilter(claim.scheduleId, claim.seatNumber, holdId, now),
      {
        $set: {
          status: 'taken',
          bookingRef: booking.bookingRef,
          bookingId: booking.id || '',
          passengerName: passenger.fullName || passenger.name || booking.guestSnapshot?.fullName || '',
          passengerPhone: passenger.phone || booking.guestSnapshot?.phone || '',
          passengerEmail: passenger.email || booking.guestSnapshot?.email || '',
        },
        $unset: { lockedUntil: '', lockId: '' },
      },
      sessionOptions(session, { new: true })
    ).lean();
    if (!updated) failures.push(`${claim.scheduleId}:${claim.seatNumber}`);
  }
  // In local/demo mode, avoid blocking checkout when a stale selected seat is already
  // taken from a previous manual/test booking. Substitute the next open seat for the
  // same schedule. Production still returns a conflict for genuinely unavailable seats.
  if (failures.length && !env.isProduction) {
    const unresolved = [];
    for (const failed of failures) {
      const [scheduleId, seatNumber] = String(failed).split(':');
      const replacement = await Seat.findOneAndUpdate(
        { scheduleId, status: 'available' },
        {
          $set: {
            status: 'taken',
            bookingRef: booking.bookingRef,
            bookingId: booking.id || '',
            passengerName: booking.guestSnapshot?.fullName || '',
            passengerPhone: booking.guestSnapshot?.phone || '',
            passengerEmail: booking.guestSnapshot?.email || '',
          },
          $unset: { lockedUntil: '', lockId: '' },
        },
        sessionOptions(session, { new: true, sort: { seatNumber: 1 } })
      ).lean();
      if (!replacement) {
        unresolved.push(failed);
        continue;
      }
      (booking.bookingItems || []).forEach((item) => {
        if (item.scheduleId === scheduleId && item.seatNumber === seatNumber) {
          item.originalSeatNumber = seatNumber;
          item.seatNumber = replacement.seatNumber;
          item.seatOrRoom = replacement.seatNumber;
          item.autoReassigned = true;
        }
      });
      (booking.passengers || []).forEach((passenger) => {
        if (passenger.scheduleId === scheduleId && (passenger.seatNumber === seatNumber || passenger.seatOrRoom === seatNumber)) {
          passenger.originalSeatNumber = seatNumber;
          passenger.seatNumber = replacement.seatNumber;
          passenger.seatOrRoom = replacement.seatNumber;
          passenger.autoReassigned = true;
        }
      });
    }
    failures.splice(0, failures.length, ...unresolved);
  }

  const touchedSchedules = [...new Set(seatClaims.map((claim) => claim.scheduleId).filter(Boolean))];
  for (const id of touchedSchedules) await refreshScheduleAvailability(id, session);
  if (failures.length) {
    const error = new Error(`Selected seat is no longer available: ${failures.join(', ')}`);
    error.status = 409;
    error.code = 'SEAT_CLAIM_FAILED';
    throw error;
  }
}

async function claimHotelRoomAtomically(booking = {}, payload = {}, session = null) {
  if (!mongoReady() || booking.serviceType !== 'hotel') return;
  const Room = require('../../models/Room');
  const RoomNightInventory = require('../../models/RoomNightInventory');
  const roomId = payload.roomId || booking.bookingItems?.[0]?.roomId || booking.bookingItems?.[0]?.roomUnitId || booking.hotelStay?.roomUnitIds?.[0];
  if (!roomId) {
    const error = new Error('Room selection is required');
    error.status = 422;
    throw error;
  }

  const { checkIn, checkOut, nights } = hotelNightRange(payload, booking);
  const roomNightQuery = {
    listingId: booking.listingId,
    date: { $in: nights },
    $or: [{ roomId }, { roomUnitId: roomId }, { id: { $in: booking.bookingItems?.[0]?.nightIds || [] } }],
    $and: [{ status: { $in: ['available', 'reserved', 'held', 'open'] } }, { $or: [{ availableInventory: { $exists: false } }, { availableInventory: { $gt: 0 } }] }],
  };
  const matchedNights = await RoomNightInventory.find(roomNightQuery, null, sessionOptions(session)).lean();
  if (matchedNights.length >= nights.length) {
    const ids = matchedNights.slice(0, nights.length).map((night) => night.id);
    const result = await RoomNightInventory.updateMany(
      { id: { $in: ids }, status: { $in: ['available', 'reserved', 'held', 'open'] }, $or: [{ availableInventory: { $exists: false } }, { availableInventory: { $gt: 0 } }] },
      {
        $inc: { availableInventory: -1 },
        $set: {
          status: 'booked',
          bookingRef: booking.bookingRef,
          guestName: booking.guestSnapshot?.fullName || 'Guest',
          checkInStatus: 'not_checked',
          notes: booking.notes || '',
        },
      },
      sessionOptions(session)
    );
    const modified = Number(result.modifiedCount || result.nModified || 0);
    if (modified < nights.length) {
      const error = new Error('Selected room nights are no longer available');
      error.status = 409;
      error.code = 'ROOM_NIGHT_CLAIM_FAILED';
      throw error;
    }
    booking.hotelStay = {
      ...(booking.hotelStay || {}),
      checkIn,
      checkOut,
      nights,
      roomCount: booking.hotelStay?.roomCount || 1,
      roomUnitIds: [...new Set(matchedNights.map((night) => night.roomUnitId || night.roomId).filter(Boolean))],
      roomTypeIds: [...new Set(matchedNights.map((night) => night.roomTypeId).filter(Boolean))],
      nightIds: ids,
      status: 'booked',
    };
    booking.bookingItems = (booking.bookingItems?.length ? booking.bookingItems : [{ id: `${booking.bookingRef}-hotel-room-1`, serviceType: 'hotel' }]).map((item, index) => index === 0 ? {
      ...item,
      serviceType: 'hotel',
      roomId,
      roomUnitId: matchedNights[0]?.roomUnitId || item.roomUnitId || roomId,
      roomTypeId: matchedNights[0]?.roomTypeId || item.roomTypeId || '',
      checkIn,
      checkOut,
      nights,
      nightIds: ids,
      status: 'confirmed',
    } : item);
    return;
  }

  const updated = await Room.findOneAndUpdate(
    { id: roomId, status: 'active', inventory: { $gt: 0 } },
    { $inc: { inventory: -1 } },
    sessionOptions(session, { new: true })
  ).lean();
  if (!updated) {
    const error = new Error('Selected room is no longer available');
    error.status = 409;
    error.code = 'ROOM_CLAIM_FAILED';
    throw error;
  }
}

async function releaseFailedBookingInventory(booking = {}, payload = {}) {
  if (!booking) return;
  const now = new Date().toISOString();
  booking.cancelledAt = booking.cancelledAt || now;
  booking.cancelReason = booking.cancelReason || 'Payment initiation failed';
  if (booking.serviceType === 'bus') {
    const seatClaims = (booking.bookingItems || []).filter((item) => item.scheduleId && item.seatNumber);
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
    if (mongoReady() && seatClaims.length) {
      const Seat = require('../../models/Seat');
      const TripSchedule = require('../../models/TripSchedule');
      await Seat.bulkWrite(seatClaims.map((claim) => ({
        updateOne: {
          filter: { scheduleId: claim.scheduleId, seatNumber: claim.seatNumber, status: 'taken' },
          update: { $set: { status: 'available' }, $unset: { lockedUntil: '', lockId: '', bookingRef: '', bookingId: '', passengerName: '', passengerPhone: '', passengerEmail: '' } },
        },
      })), { ordered: false });
      const scheduleCounts = seatClaims.reduce((acc, claim) => { acc[claim.scheduleId] = (acc[claim.scheduleId] || 0) + 1; return acc; }, {});
      await TripSchedule.bulkWrite(Object.entries(scheduleCounts).map(([id, count]) => ({ updateOne: { filter: { id }, update: { $inc: { availableSeats: count } } } })), { ordered: false });
    }
  }
  if (booking.serviceType === 'hotel') {
    const roomId = payload.roomId || booking.bookingItems?.[0]?.roomId || booking.bookingItems?.[0]?.roomUnitId || booking.hotelStay?.roomUnitIds?.[0];
    const nightIds = booking.hotelStay?.nightIds || booking.bookingItems?.flatMap((item) => item.nightIds || []) || [];
    const room = store.state.rooms.find((item) => item.id === roomId);
    if (room) room.inventory = Number(room.inventory || 0) + 1;
    (store.state.roomNightInventories || []).forEach((night) => {
      if ((nightIds.length && nightIds.includes(night.id)) || (night.bookingRef === booking.bookingRef)) {
        night.status = 'available';
        night.bookingRef = '';
        night.guestName = '';
        night.checkInStatus = '';
        night.updatedAt = new Date().toISOString();
      }
    });
    if (mongoReady()) {
      const Room = require('../../models/Room');
      const RoomNightInventory = require('../../models/RoomNightInventory');
      if (roomId) await Room.updateOne({ id: roomId }, { $inc: { inventory: 1 } });
      await RoomNightInventory.updateMany(
        nightIds.length ? { id: { $in: nightIds }, bookingRef: booking.bookingRef } : { bookingRef: booking.bookingRef },
        { $inc: { availableInventory: 1 }, $set: { status: 'open', bookingRef: '', guestName: '', checkInStatus: '' }, $unset: { holdId: '' } }
      );
    }
  }
  if (payload.holdId) await inventoryHoldService.releaseHold(payload.holdId, 'payment_failed');
}

async function persistBooking(booking, payload, transactionStartIndex, options = {}) {
  if (payload.holdId && !options.skipHoldConsume) {
    await inventoryHoldService.consumeHold(payload.holdId, booking, { userId: booking.customerUserId || 'guest-checkout' });
  }

  if (!mongoReady()) return;

  await runMongoUnitOfWork(async (session) => {
    if (options.claimInventory) {
      if (booking.serviceType === 'bus') await claimBusSeatsAtomically(booking, payload, session);
      if (booking.serviceType === 'hotel') await claimHotelRoomAtomically(booking, payload, session);
    }
    await persistBookingRows(booking, payload, transactionStartIndex, session);
  });
}

async function persistBookingRows(booking, payload, transactionStartIndex, session = null) {
  const Booking = require('../../models/Booking');
  const WalletTransaction = require('../../models/WalletTransaction');
  const Wallet = require('../../models/Wallet');
  const Commission = require('../../models/Commission');

  await Booking.updateOne(
    { bookingRef: booking.bookingRef },
    { $set: booking },
    sessionOptions(session, { upsert: true, runValidators: true })
  );

  const Passenger = require('../../models/Passenger');
  if (booking.passengers?.length) {
    await Passenger.bulkWrite(booking.passengers.map((passenger, index) => ({
      updateOne: {
        filter: { id: passenger.id || `${booking.id}-passenger-${index + 1}` },
        update: { $set: { ...passenger, id: passenger.id || `${booking.id}-passenger-${index + 1}`, bookingId: booking.id, bookingRef: booking.bookingRef, companyId: booking.companyId, listingId: booking.listingId, scheduleId: booking.scheduleId, passengerIndex: index } },
        upsert: true,
      },
    })), sessionOptions(session, { ordered: false }));
  }

  if (booking.paymentRef || booking.paymentProvider) {
    const Payment = require('../../models/Payment');
    await Payment.updateOne(
      { providerReference: booking.paymentRef || `${booking.bookingRef}:pending`, bookingRef: booking.bookingRef },
      {
        $set: {
          id: `payment-${booking.bookingRef}`,
          bookingId: booking.id,
          bookingRef: booking.bookingRef,
          companyId: booking.companyId,
          customerUserId: booking.customerUserId || '',
          provider: booking.paymentProvider || payload.provider || 'mock',
          providerReference: booking.paymentRef || '',
          amount: booking.pricing?.total || 0,
          currency: booking.pricing?.currency || 'UGX',
          status: booking.paymentStatus || 'pending',
          paidAt: booking.paymentStatus === 'successful' ? new Date() : null,
          checkoutUrl: booking.checkoutUrl || '',
          idempotencyKey: `${booking.paymentProvider || payload.provider || 'mock'}:${booking.bookingRef}:${booking.paymentRef || 'pending'}`,
          metadata: { source: 'bookingService.persistBooking' },
        },
      },
      sessionOptions(session, { upsert: true, runValidators: true })
    );
  }

  const newTransactions = store.state.walletTransactions.slice(transactionStartIndex);
  if (newTransactions.length) {
    await WalletTransaction.bulkWrite(newTransactions.map((txn) => ({
      updateOne: {
        filter: { id: txn.id },
        update: { $set: txn },
        upsert: true,
      },
    })), sessionOptions(session, { ordered: false }));
  }

  const affectedWalletKeys = new Set(newTransactions.map((txn) => `${txn.ownerType}:${txn.ownerId}`));
  const affectedWallets = store.state.wallets.filter((wallet) => affectedWalletKeys.has(`${wallet.ownerType}:${wallet.ownerId}`));
  if (affectedWallets.length) {
    await Wallet.bulkWrite(affectedWallets.map((wallet) => ({
      updateOne: {
        filter: { ownerType: wallet.ownerType, ownerId: wallet.ownerId },
        update: { $set: wallet },
        upsert: true,
      },
    })), sessionOptions(session));
  }

  const commissions = store.state.commissions.filter((commission) => commission.bookingId === booking.id);
  if (commissions.length) {
    await Commission.bulkWrite(commissions.map((commission) => ({
      updateOne: {
        filter: { id: commission.id },
        update: { $set: commission },
        upsert: true,
      },
    })), sessionOptions(session));
  }
}


async function createGuestBooking(payload, req) {
  const provider = payload.provider || payload.paymentProvider || env.paymentProvider;
  const transactionStartIndex = store.state.walletTransactions.length;
  const booking = store.createBooking({
    ...payload,
    deferPayment: provider !== 'mock',
  }, req);
  const paymentService = require('../payment/paymentService');
  try {
    const intentBase = {
      id: `payment-intent-${booking.bookingRef}`,
      intentRef: `PI-${booking.bookingRef}`,
      bookingId: booking.id,
      bookingRef: booking.bookingRef,
      companyId: booking.companyId,
      customerUserId: booking.customerUserId || '',
      provider,
      idempotencyKey: `${provider}:${booking.bookingRef}:initiate`,
      amount: booking.pricing?.total,
      currency: booking.pricing?.currency,
      status: 'created',
      expiresAt: booking.lockedUntil,
      attempts: [{ at: new Date().toISOString(), provider, status: 'created' }],
      metadata: { source: 'bookingService.createGuestBooking' },
    };
    await persistPaymentIntent(intentBase);
    await persistBooking(booking, payload, transactionStartIndex, { claimInventory: true });
    await recordBookingTimeline(booking, 'booking.created', `Booking ${booking.bookingRef} created`, 'Inventory was selected and booking record was created.', { metadata: { source: payload.source || 'checkout', holdId: payload.holdId || '' } });
    await recordBookingTimeline(booking, 'inventory.claimed', `Inventory claimed for ${booking.bookingRef}`, booking.serviceType === 'bus' ? 'Selected seat inventory was connected to this booking.' : 'Selected room inventory was connected to this booking.', { entityType: 'inventory', entityId: payload.holdId || booking.scheduleId || booking.listingId });
    const payment = await paymentService.initiatePayment({
      ...payload,
      provider,
      bookingRef: booking.bookingRef,
      amount: booking.pricing?.total,
      currency: booking.pricing?.currency,
      customer: booking.guestSnapshot,
      idempotencyKey: intentBase.idempotencyKey,
    });
    await persistPaymentIntent({
      ...intentBase,
      providerReference: payment.providerReference || '',
      checkoutUrl: payment.checkoutUrl || '',
      status: payment.status || 'pending',
      paidAt: payment.status === 'successful' ? new Date().toISOString() : null,
      attempts: [...intentBase.attempts, { at: new Date().toISOString(), provider, status: payment.status || 'pending', providerReference: payment.providerReference || '' }],
    });
    booking.paymentProvider = payment.provider;
    booking.paymentRef = payment.providerReference;
    booking.checkoutUrl = payment.checkoutUrl || '';
    booking.paymentStatus = payment.status || booking.paymentStatus;
    if (booking.paymentStatus === 'successful') {
      booking.bookingStatus = 'confirmed';
      store.settleBookingPayment(booking.bookingRef);
      await recordBookingTimeline(booking, 'payment.succeeded', `Payment received for ${booking.bookingRef}`, 'Payment was confirmed and tickets are valid for operation.', { entityType: 'payment', entityId: payment.providerReference || booking.paymentRef || '', status: 'successful', metadata: { provider: payment.provider } });
      await recordBookingTimeline(booking, 'ticket.issued', `Ticket issued for ${booking.bookingRef}`, `${(booking.ticketLegs || []).length || 1} ticket leg(s) are available for QR validation.`, { entityType: 'ticket', entityId: booking.ticketLegs?.[0]?.id || booking.bookingRef, status: 'issued' });
    } else {
      await recordBookingTimeline(booking, 'payment.pending', `Payment pending for ${booking.bookingRef}`, 'Booking is waiting for payment confirmation before operation.', { entityType: 'payment', entityId: payment.providerReference || booking.paymentRef || '', status: booking.paymentStatus || 'pending', metadata: { provider: payment.provider, checkoutUrl: payment.checkoutUrl || '' } });
    }
  } catch (error) {
    booking.paymentStatus = 'failed';
    booking.bookingStatus = 'cancelled';
    await releaseFailedBookingInventory(booking, payload);
    await persistPaymentIntent({
      id: `payment-intent-${booking.bookingRef}`,
      intentRef: `PI-${booking.bookingRef}`,
      bookingId: booking.id,
      bookingRef: booking.bookingRef,
      companyId: booking.companyId,
      customerUserId: booking.customerUserId || '',
      provider,
      idempotencyKey: `${provider}:${booking.bookingRef}:initiate`,
      amount: booking.pricing?.total,
      currency: booking.pricing?.currency,
      status: 'failed',
      failedAt: new Date().toISOString(),
      failureReason: error.message,
      metadata: { source: 'bookingService.createGuestBooking' },
    });
    await persistBooking(booking, payload, transactionStartIndex, { skipHoldConsume: true });
    await recordBookingTimeline(booking, 'payment.failed', `Payment failed for ${booking.bookingRef}`, error.message || 'Payment failed and inventory was released.', { entityType: 'payment', status: 'failed', visibility: 'shared' });
    throw error;
  }
  await persistBooking(booking, payload, transactionStartIndex, { skipHoldConsume: true });
  const notificationService = require('../notification/notificationService');
  if (booking.bookingStatus === 'confirmed') {
    await notificationService.bookingConfirmed(booking);
  } else {
    await notificationService.queueNotification({
      userId: booking.customerUserId || null,
      channels: ['email', 'sms'],
      title: `Payment pending ${booking.bookingRef}`,
      message: `Your Classic Trip booking ${booking.bookingRef} is waiting for payment confirmation.`,
      recipient: {
        email: booking.guestSnapshot?.email,
        phone: booking.guestSnapshot?.phone,
        name: booking.guestSnapshot?.fullName,
      },
      referenceType: 'booking',
      referenceId: booking.id,
      meta: { bookingRef: booking.bookingRef, checkoutUrl: booking.checkoutUrl },
    });
  }
  const ticketPdfService = require('../pdf/ticketPdfService');
  const listing = store.findListing(booking.listingId);
  booking.ticketPdf = await ticketPdfService.uploadTicketPdf(booking, listing);
  await persistBooking(booking, payload, store.state.walletTransactions.length, { skipHoldConsume: true });
  return booking;
}

async function persistCheckIn(booking) {
  if (!mongoReady() || !booking) return;
  const Booking = require('../../models/Booking');
  await Booking.updateOne(
    { bookingRef: booking.bookingRef },
    {
      $set: {
        bookingStatus: booking.bookingStatus,
        checkedInAt: booking.checkedInAt,
        checkedInBy: booking.checkedInBy,
        checkedInByUserId: booking.checkedInByUserId,
        checkInStatus: booking.checkInStatus,
        checkInNote: booking.checkInNote,
        noShowAt: booking.noShowAt,
        noShowBy: booking.noShowBy,
        noShowByUserId: booking.noShowByUserId,
        cancelledAt: booking.cancelledAt,
        cancelReason: booking.cancelReason,
        completedAt: booking.completedAt,
        settlementStatus: booking.settlementStatus,
        passengers: booking.passengers || [],
        ticketLegs: booking.ticketLegs || [],
        scanHistory: booking.scanHistory || [],
      },
    }
  );
}

async function persistFinancialRelease(booking, commissions = []) {
  if (!mongoReady() || !booking) return;
  const Wallet = require('../../models/Wallet');
  const WalletTransaction = require('../../models/WalletTransaction');
  const Commission = require('../../models/Commission');
  const Booking = require('../../models/Booking');
  const ownerKeys = new Set([
    `company:${booking.companyId}`,
    booking.promoterAttribution?.promoterId ? `promoter:${booking.promoterAttribution.promoterId}` : '',
  ].filter(Boolean));
  const wallets = store.state.wallets.filter((wallet) => ownerKeys.has(`${wallet.ownerType}:${wallet.ownerId}`));
  if (wallets.length) {
    await Wallet.bulkWrite(wallets.map((wallet) => ({
      updateOne: {
        filter: { ownerType: wallet.ownerType, ownerId: wallet.ownerId },
        update: { $set: wallet },
        upsert: true,
      },
    })));
  }
  const txns = store.state.walletTransactions.filter((txn) => txn.referenceType === 'booking' && txn.referenceId === booking.id);
  if (txns.length) {
    await WalletTransaction.bulkWrite(txns.map((txn) => ({
      updateOne: {
        filter: { id: txn.id },
        update: { $set: txn },
        upsert: true,
      },
    })));
  }
  if (commissions.length) {
    await Commission.bulkWrite(commissions.map((commission) => ({
      updateOne: {
        filter: { id: commission.id },
        update: { $set: commission },
        upsert: true,
      },
    })));
  }
  await Booking.updateOne({ bookingRef: booking.bookingRef }, { $set: { earningsReleasedAt: booking.earningsReleasedAt } });
}

async function validateTicket(value, employeeId = 'employee-system', companyId = '', context = {}) {
  const releaseService = require('../commission/releaseService');
  const result = store.validateTicket(value, employeeId, companyId, context);
  if (result.booking) result.listing = store.findListing(result.booking.listingId);
  await ticketScanService.recordScan('validate', value, result, { ...context, userId: employeeId, companyId });
  if (result.ok && result.booking?.bookingStatus === 'checked_in') {
    const released = releaseService.releaseCompletedBooking(result.booking.bookingRef) || [];
    result.releasedCommissions = released;
    await recordBookingTimeline(result.booking, 'ticket.checked_in', `Ticket checked in for ${result.booking.bookingRef}`, result.message || 'Passenger check-in was accepted.', { entityType: 'ticket_scan', entityId: result.ticket?.id || result.ticket?.ticketNumber || result.booking.bookingRef, actorType: context.actorRole || 'employee', actorId: employeeId, actorName: context.actorName || '', status: 'checked_in', metadata: { location: context.location || '', scheduleId: context.scheduleId || result.ticket?.scheduleId || '' } });
    await persistCheckIn(result.booking);
    await persistFinancialRelease(result.booking, released);
  } else if (result.booking) {
    await recordBookingTimeline(result.booking, result.ok ? 'ticket.scan.updated' : 'ticket.scan.failed', result.ok ? `Ticket scan updated for ${result.booking.bookingRef}` : `Ticket scan failed for ${result.booking.bookingRef}`, result.message || 'Ticket scan was recorded.', { entityType: 'ticket_scan', entityId: result.ticket?.id || result.ticket?.ticketNumber || result.booking.bookingRef, actorType: context.actorRole || 'employee', actorId: employeeId, actorName: context.actorName || '', status: result.ok ? 'accepted' : 'failed', visibility: result.ok ? 'shared' : 'internal', metadata: { result: result.result || '', location: context.location || '', scheduleId: context.scheduleId || result.ticket?.scheduleId || '' } });
    await persistCheckIn(result.booking);
  }
  return result;
}


async function lookupTicket(value, companyId = '', context = {}) {
  const result = store.lookupTicket(value, companyId, context);
  await ticketScanService.recordScan('lookup', value, result, { ...context, companyId });
  return result;
}

async function markNoShow(value, employeeId = 'employee-system', companyId = '', note = '', context = {}) {
  const result = store.markNoShow(value, employeeId, companyId, note, context);
  await ticketScanService.recordScan('no_show', value, result, { ...context, userId: employeeId, companyId, note });
  if (result.ok) {
    await recordBookingTimeline(result.booking, 'ticket.no_show', `No-show marked for ${result.booking.bookingRef}`, note || result.message || 'Passenger was marked as no-show.', { entityType: 'ticket_scan', entityId: result.ticket?.id || result.ticket?.ticketNumber || result.booking.bookingRef, actorType: context.actorRole || 'employee', actorId: employeeId, actorName: context.actorName || '', status: 'no_show', metadata: { location: context.location || '', scheduleId: context.scheduleId || result.ticket?.scheduleId || '' } });
    await persistCheckIn(result.booking);
  }
  return result;
}

function lookupBooking(bookingRef, contact = '') {
  const booking = store.findBooking(bookingRef);
  if (!booking) return null;
  if (!contact) return booking;
  const key = String(contact).toLowerCase();
  const email = String(booking.guestSnapshot?.email || '').toLowerCase();
  const phone = String(booking.guestSnapshot?.phone || '').toLowerCase();
  return email.includes(key) || phone.includes(key) ? booking : null;
}

function cancelBooking(bookingRef, reason = 'Customer requested cancellation') {
  const booking = store.findBooking(bookingRef);
  if (!booking) return null;
  booking.bookingStatus = 'cancelled';
  booking.cancelReason = reason;
  booking.cancelledAt = new Date().toISOString();
  booking.ticketLegs = (booking.ticketLegs || []).map((leg) => ({ ...leg, status: 'cancelled', checkInStatus: 'cancelled', cancelledAt: booking.cancelledAt }));
  if (booking.serviceType === 'bus') {
    const seatClaims = (booking.bookingItems || []).filter((item) => item.scheduleId && item.seatNumber);
    seatClaims.forEach((claim) => {
      const seat = store.state.seats.find((item) => item.scheduleId === claim.scheduleId && item.seatNumber === claim.seatNumber);
      if (seat && seat.status === 'taken') {
        seat.status = 'available';
        seat.lockedUntil = null;
        seat.lockId = null;
      }
      const schedule = store.state.schedules.find((item) => item.id === claim.scheduleId);
      if (schedule) schedule.availableSeats = Number(schedule.availableSeats || 0) + 1;
    });
    if (mongoReady() && seatClaims.length) {
      const Seat = require('../../models/Seat');
      const TripSchedule = require('../../models/TripSchedule');
      Seat.bulkWrite(seatClaims.map((claim) => ({ updateOne: { filter: { scheduleId: claim.scheduleId, seatNumber: claim.seatNumber, status: 'taken' }, update: { $set: { status: 'available' }, $unset: { lockedUntil: '', lockId: '' } } } })), { ordered: false }).catch(() => {});
      const scheduleCounts = seatClaims.reduce((acc, claim) => { acc[claim.scheduleId] = (acc[claim.scheduleId] || 0) + 1; return acc; }, {});
      TripSchedule.bulkWrite(Object.entries(scheduleCounts).map(([id, count]) => ({ updateOne: { filter: { id }, update: { $inc: { availableSeats: count } } } })), { ordered: false }).catch(() => {});
    }
  }
  store.persistBookingGraph(booking);
  return booking;
}

module.exports = { createGuestBooking, lookupTicket, validateTicket, markNoShow, lookupBooking, cancelBooking };

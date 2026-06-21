const store = require('../data/persistentStore');
const { addMinutes } = require('../../utils/dates');
const { mongoose } = require('../../config/db');
const repositories = require('../../repositories');
const inventoryHoldService = require('./inventoryHoldService');

function mongoReady() {
  return mongoose.connection.readyState === 1;
}

function holdId() {
  return `seat-hold-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function assertSeatCanBeHeld(scheduleId, seatNumber, now = new Date()) {
  const existingActiveHold = (store.state.inventoryHolds || []).find((hold) => hold.holdType === 'seat'
    && hold.scheduleId === scheduleId
    && String(hold.seatNumber) === String(seatNumber)
    && hold.status === 'active'
    && new Date(hold.expiresAt || hold.lockedUntil || 0) > now);
  if (existingActiveHold) {
    const error = new Error('Seat is temporarily held by another checkout');
    error.status = 409;
    throw error;
  }
  const paidBooking = (store.state.bookings || []).find((booking) => booking.scheduleId === scheduleId
    && String(booking.seatNumber || booking.selectedSeat || booking.seat) === String(seatNumber)
    && !['cancelled', 'refunded', 'failed'].includes(String(booking.bookingStatus || booking.status || '').toLowerCase())
    && !['failed', 'cancelled', 'refunded'].includes(String(booking.paymentStatus || '').toLowerCase()));
  if (paidBooking) {
    const error = new Error('Seat is already booked');
    error.status = 409;
    throw error;
  }
}

function lockSeat(scheduleId, seatNumber, minutes = 10) {
  const now = new Date();
  const seat = store.state.seats.find((item) => item.scheduleId === scheduleId && item.seatNumber === seatNumber);
  if (!seat) throw new Error('Seat not found');
  assertSeatCanBeHeld(scheduleId, seatNumber, now);
  if (['taken', 'booked', 'checked-in', 'checked_in', 'cancelled', 'refunded', 'disabled', 'maintenance', 'blocked'].includes(String(seat.status || '').toLowerCase())) throw new Error('Seat is not available');
  if (seat.lockedUntil && new Date(seat.lockedUntil) > now) throw new Error('Seat is temporarily locked');
  const nextHoldId = holdId();
  seat.status = 'locked';
  seat.lockedUntil = addMinutes(now, minutes).toISOString();
  seat.lockId = nextHoldId;
  return { id: nextHoldId, type: 'seat', scheduleId, seatNumber, lockedUntil: seat.lockedUntil, seat };
}

function releaseSeatHold(hold = {}) {
  const seat = store.state.seats.find((item) => item.scheduleId === hold.scheduleId && item.seatNumber === hold.seatNumber);
  if (seat && seat.status === 'locked' && (!hold.id || seat.lockId === hold.id || seat.lockId === hold.groupId)) {
    seat.status = 'available';
    seat.lockedUntil = null;
    seat.lockId = null;
    return true;
  }
  return false;
}

async function lockSeatPersistent(scheduleId, seatNumber, minutes = 10, context = {}) {
  if (!mongoReady()) {
    const hold = lockSeat(scheduleId, seatNumber, minutes);
    await inventoryHoldService.recordSeatHold(hold, context);
    return hold;
  }

  const now = new Date();

  // Expire stale holds and release expired seat locks in MongoDB so they don't block new ones.
  await Promise.all([
    repositories.inventoryHolds.updateMany(
      { scheduleId, seatNumber, holdType: 'seat', status: 'active', expiresAt: { $lte: now } },
      { $set: { status: 'expired', releasedAt: now, releaseReason: 'expired' } }
    ),
    repositories.seats.updateMany(
      { scheduleId, seatNumber, status: 'locked', lockedUntil: { $lte: now } },
      { $set: { status: 'available' }, $unset: { lockedUntil: '', lockId: '' } }
    ),
  ]);

  const lockedUntil = addMinutes(now, minutes);
  const nextHoldId = holdId();
  const activeHoldCount = await repositories.inventoryHolds.count({ holdType: 'seat', scheduleId, seatNumber, status: 'active', expiresAt: { $gt: now } });
  if (activeHoldCount) {
    const error = new Error('Seat is temporarily held by another checkout');
    error.status = 409;
    throw error;
  }

  const seat = await repositories.seats.findOneAndUpdate(
    {
      scheduleId,
      seatNumber,
      status: { $nin: ['taken', 'booked', 'checked-in', 'checked_in', 'cancelled', 'refunded', 'disabled', 'maintenance', 'blocked'] },
      $or: [
        { status: 'available' },
        { lockedUntil: null },
        { lockedUntil: { $exists: false } },
        { lockedUntil: { $lte: now } },
      ],
    },
    { $set: { status: 'locked', lockedUntil, lockId: nextHoldId } },
    { new: true }
  );

  if (!seat) {
    // Seat not in MongoDB (created in-memory only by ensureBookableInventory). Fall back to in-memory lock.
    const memSeat = store.state.seats.find((item) => item.scheduleId === scheduleId && item.seatNumber === seatNumber);
    if (memSeat && !['taken', 'booked', 'checked-in', 'checked_in', 'locked'].includes(String(memSeat.status || '').toLowerCase())) {
      const hold = lockSeat(scheduleId, seatNumber, minutes);
      await inventoryHoldService.recordSeatHold(hold, context);
      return hold;
    }
    const error = new Error('Seat is temporarily locked');
    error.status = 409;
    throw error;
  }

  let stateSeat = store.state.seats.find((item) => item.scheduleId === scheduleId && item.seatNumber === seatNumber);
  if (!stateSeat) {
    stateSeat = { id: seat.id, scheduleId, seatNumber };
    store.state.seats.push(stateSeat);
  }
  Object.assign(stateSeat, { ...seat, id: seat.id || stateSeat.id, status: 'locked', lockedUntil: lockedUntil.toISOString(), lockId: nextHoldId });

  const hold = { id: nextHoldId, type: 'seat', scheduleId, seatNumber, lockedUntil: lockedUntil.toISOString(), seat: stateSeat };
  await inventoryHoldService.recordSeatHold(hold, context);
  return hold;
}

async function releaseSeatHoldPersistent(hold = {}) {
  const released = releaseSeatHold(hold);
  if (mongoReady() && hold.scheduleId && hold.seatNumber) {
    await repositories.seats.updateMany(
      { scheduleId: hold.scheduleId, seatNumber: hold.seatNumber, lockId: hold.id },
      { $set: { status: 'available' }, $unset: { lockedUntil: '', lockId: '' } }
    );
  }
  return released;
}

async function lockSeatsPersistent(scheduleId, seatNumbers = [], minutes = 10, context = {}) {
  const requestedSeats = [...new Set([].concat(seatNumbers).map((seat) => String(seat || '').trim()).filter(Boolean))];
  if (requestedSeats.length <= 1) {
    const hold = await lockSeatPersistent(scheduleId, requestedSeats[0], minutes, context);
    return { ...hold, seatNumbers: [hold.seatNumber], holds: [hold] };
  }

  const groupId = holdId().replace('seat-hold-', 'seat-hold-group-');
  const holds = [];
  try {
    for (const seatNumber of requestedSeats) {
      const hold = await lockSeatPersistent(scheduleId, seatNumber, minutes, { ...context, groupedHoldId: groupId });
      holds.push({ ...hold, groupId });
    }
    holds.forEach((hold) => {
      if (hold.seat) hold.seat.lockId = groupId;
      hold.id = groupId;
    });
    if (mongoReady()) {
      await repositories.seats.updateMany(
        { scheduleId, seatNumber: { $in: requestedSeats }, status: 'locked' },
        { $set: { lockId: groupId } }
      );
    }
    const groupedHold = {
      id: groupId,
      type: 'seats',
      scheduleId,
      seatNumber: requestedSeats[0],
      seatNumbers: requestedSeats,
      lockedUntil: holds[0]?.lockedUntil,
      holds,
      seat: holds[0]?.seat,
    };
    await inventoryHoldService.recordGroupedSeatHold(groupedHold, context);
    return groupedHold;
  } catch (error) {
    await Promise.all(holds.map((hold) => releaseSeatHoldPersistent(hold)));
    throw error;
  }
}

function releaseExpiredLocks(now = new Date()) {
  let released = 0;
  for (const seat of store.state.seats) {
    if (seat.status === 'locked' && seat.lockedUntil && new Date(seat.lockedUntil) <= now) {
      seat.status = 'available';
      seat.lockedUntil = null;
      seat.lockId = null;
      released += 1;
    }
  }
  return released;
}

async function releaseExpiredLocksPersistent(now = new Date()) {
  const released = releaseExpiredLocks(now);
  if (mongoReady()) {
    const result = await repositories.seats.updateMany(
      { status: 'locked', lockedUntil: { $lte: now } },
      { $set: { status: 'available' }, $unset: { lockedUntil: '', lockId: '' } }
    );
    return Math.max(released, result.modifiedCount || 0);
  }
  return released;
}

module.exports = { lockSeat, lockSeatPersistent, lockSeatsPersistent, releaseExpiredLocks, releaseExpiredLocksPersistent };

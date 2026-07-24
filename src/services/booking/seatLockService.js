'use strict';

const { addMinutes } = require('../../utils/dates');
const repositories = require('../../repositories');
const inventoryHoldService = require('./inventoryHoldService');
const { getCachedPlatformConfig } = require('../platform/platformConfigService');

function holdId() {
  return `seat-hold-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function existingActiveHold(resourceKey, now = new Date()) {
  return repositories.inventoryHoldItems.findOne({ resourceKey, status: 'active', expiresAt: { $gt: now } });
}

async function assertSeatCanBeHeld(scheduleId, seatNumber, resourceKey, now = new Date()) {
  const [activeHold, seat] = await Promise.all([
    existingActiveHold(resourceKey, now),
    repositories.seats.findOne({ scheduleId, seatNumber }),
  ]);
  if (activeHold) throw Object.assign(new Error('Seat is temporarily held by another checkout'), { status: 409 });
  if (!seat) throw Object.assign(new Error('Seat does not exist for this departure'), { status: 404 });
  if (['taken', 'booked', 'checked_in'].includes(String(seat.status || '').toLowerCase())) {
    throw Object.assign(new Error('Seat is already booked'), { status: 409 });
  }
  if (['disabled', 'maintenance', 'blocked'].includes(String(seat.status || '').toLowerCase())) {
    throw Object.assign(new Error('Seat is not available for sale'), { status: 409 });
  }
  if (seat.status === 'locked' && seat.lockedUntil && new Date(seat.lockedUntil) > now) {
    throw Object.assign(new Error('Seat is temporarily held by another checkout'), { status: 409 });
  }
  return seat;
}

async function lockSeat(scheduleId, seatNumber, minutes = null, context = {}) {

  const now = new Date();
  const resourceKey = inventoryHoldService.seatResourceKey(scheduleId, seatNumber);
  await Promise.all([
    repositories.inventoryHolds.updateMany(
      { scheduleId, seatNumber, holdType: 'seat', status: 'active', expiresAt: { $lte: now } },
      { $set: { status: 'expired', releasedAt: now, releaseReason: 'expired' } },
    ),
    repositories.inventoryHoldItems.updateMany(
      { resourceKey, status: 'active', expiresAt: { $lte: now } },
      { $set: { status: 'expired', releasedAt: now, releaseReason: 'expired' } },
    ),
    repositories.seats.updateMany(
      { scheduleId, seatNumber, status: 'locked', lockedUntil: { $lte: now } },
      { $set: { status: 'available' }, $unset: { lockedUntil: '', lockId: '' } },
    ),
  ]);

  const lockedUntil = addMinutes(now, Number(minutes) > 0 ? Number(minutes) : getCachedPlatformConfig().holdMinutes);
  const nextHoldId = holdId();
  await assertSeatCanBeHeld(scheduleId, seatNumber, resourceKey, now);

  const seat = await repositories.seats.findOneAndUpdate(
    {
      scheduleId,
      seatNumber,
      status: { $nin: ['taken', 'booked', 'checked_in', 'no_show', 'cancelled', 'refunded', 'disabled', 'maintenance', 'blocked'] },
      $or: [{ status: 'available' }, { lockedUntil: null }, { lockedUntil: { $exists: false } }, { lockedUntil: { $lte: now } }],
    },
    { $set: { status: 'locked', lockedUntil, lockId: nextHoldId } },
    { new: true, runValidators: true },
  );

  if (!seat) throw Object.assign(new Error('Seat is temporarily locked or unavailable'), { status: 409 });
  const hold = { id: nextHoldId, type: 'seat', scheduleId, seatNumber, lockedUntil: lockedUntil.toISOString(), seat };
  if (!context.deferHoldPersistence) await inventoryHoldService.recordSeatHold(hold, context);
  return hold;
}

async function releaseSeatHold(hold = {}) {
  if (!hold.scheduleId || !hold.seatNumber) return false;
  const lockIds = [hold.id, hold.groupId].filter(Boolean);
  if (!lockIds.length) return false;
  const result = await repositories.seats.updateMany(
    { scheduleId: hold.scheduleId, seatNumber: hold.seatNumber, lockId: { $in: lockIds } },
    { $set: { status: 'available' }, $unset: { lockedUntil: '', lockId: '' } },
  );
  return Boolean(result?.modifiedCount || 0);
}

async function lockSeats(scheduleId, seatNumbers = [], minutes = null, context = {}) {
  const requestedSeats = [...new Set([].concat(seatNumbers).map((seat) => String(seat || '').trim()).filter(Boolean))];
  if (!requestedSeats.length) throw Object.assign(new Error('At least one seat is required'), { status: 422 });
  if (requestedSeats.length === 1) {
    const hold = await lockSeat(scheduleId, requestedSeats[0], minutes, context);
    return { ...hold, seatNumbers: [hold.seatNumber], holds: [hold] };
  }

  const groupId = holdId().replace('seat-hold-', 'seat-hold-group-');
  const holds = [];
  try {
    for (const seatNumber of requestedSeats) {
      const hold = await lockSeat(scheduleId, seatNumber, minutes, { ...context, groupedHoldId: groupId, deferHoldPersistence: true });
      holds.push({ ...hold, groupId });
    }
    await repositories.seats.updateMany(
      { scheduleId, seatNumber: { $in: requestedSeats }, status: 'locked' },
      { $set: { lockId: groupId } },
    );
    const groupedHold = { id: groupId, type: 'seats', scheduleId, seatNumber: requestedSeats[0], seatNumbers: requestedSeats, lockedUntil: holds[0]?.lockedUntil, holds, seat: holds[0]?.seat };
    await inventoryHoldService.recordGroupedSeatHold(groupedHold, context);
    return groupedHold;
  } catch (error) {
    await Promise.allSettled([
      ...holds.map((hold) => releaseSeatHold(hold)),
      inventoryHoldService.releaseHold(groupId, 'group_lock_failed'),
    ]);
    throw error;
  }
}

async function releaseExpiredLocks(now = new Date()) {
  const result = await repositories.seats.updateMany(
    { status: 'locked', lockedUntil: { $lte: now } },
    { $set: { status: 'available' }, $unset: { lockedUntil: '', lockId: '' } },
  );
  return result?.modifiedCount || 0;
}

module.exports = { lockSeat, lockSeats, releaseSeatHold, releaseExpiredLocks, assertSeatCanBeHeld, existingActiveHold };

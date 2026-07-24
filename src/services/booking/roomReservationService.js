'use strict';

const inventoryHoldService = require('./inventoryHoldService');
const hotelInventoryService = require('../hotel/hotelInventoryService');
const hotelRepository = require('../../repositories/domain/hotelRepository');

function nowDate(value = new Date()) {
  return value instanceof Date ? value : new Date(value);
}

async function findActiveReservation(reservationId, roomUnitId = '') {
  const now = new Date();
  return hotelRepository.inventoryHolds.findOne({
    id: reservationId,
    holdType: 'room',
    status: 'active',
    expiresAt: { $gt: now },
    ...(roomUnitId ? { roomUnitIds: roomUnitId } : {}),
  });
}

async function roomActiveHoldCount(selectionId, now = new Date()) {
  const at = nowDate(now);
  const unit = await hotelRepository.roomUnits.findOne({ id: selectionId });
  const roomTypeId = unit?.roomTypeId || selectionId;
  const units = unit ? [unit] : await hotelRepository.roomUnits.list({ roomTypeId, status: { $ne: 'archived' } });
  if (!units.length) return 0;
  const unitIds = units.map((row) => row.id);
  const items = await hotelRepository.inventoryHoldItems.list({
    resourceType: 'room_unit_night',
    roomUnitId: { $in: unitIds },
    status: 'active',
    expiresAt: { $gt: at },
  });
  return new Set(items.map((row) => row.holdId)).size;
}

async function reserveRoom() {
  const error = new Error('Hotel room holds are created only by the canonical hotel booking engine');
  error.status = 409;
  error.code = 'CANONICAL_HOTEL_ENGINE_REQUIRED';
  throw error;
}

async function releaseExpiredReservations(now = new Date()) {
  const at = nowDate(now);
  const [holds, pendingBookings] = await Promise.all([
    inventoryHoldService.expireActiveHolds(at),
    hotelInventoryService.releaseExpiredPendingBookings(at),
  ]);
  return { holds, pendingBookings };
}

async function consumeReservation(reservationId, roomUnitId = '') {
  const reservation = await findActiveReservation(reservationId, roomUnitId);
  if (!reservation) return null;
  await inventoryHoldService.consumeHold(reservationId, {}, { userId: 'room-reservation' });
  return { ...reservation, status: 'consumed', consumedAt: new Date().toISOString() };
}

module.exports = {
  reserveRoom,
  releaseExpiredReservations,
  findActiveReservation,
  consumeReservation,
  roomActiveHoldCount,
};

const store = require('../data/persistentStore');
const { addMinutes } = require('../../utils/dates');
const inventoryHoldService = require('./inventoryHoldService');
const repositories = require('../../repositories');

const reservations = [];

function findActiveReservation(reservationId, roomId) {
  const now = new Date();
  return reservations.find((item) => (
    item.id === reservationId
    && (!roomId || item.roomId === roomId)
    && new Date(item.expiresAt) > now
  )) || (store.state.inventoryHolds || []).find((item) => (
    item.id === reservationId
    && item.holdType === 'room'
    && item.status === 'active'
    && (!roomId || item.roomId === roomId)
    && new Date(item.expiresAt || item.lockedUntil) > now
  ));
}

function roomActiveHoldCount(roomId, now = new Date()) {
  const memoryReservations = reservations.filter((item) => item.roomId === roomId && new Date(item.expiresAt) > now).length;
  const memoryHolds = (store.state.inventoryHolds || []).filter((item) => (
    item.holdType === 'room'
    && item.roomId === roomId
    && item.status === 'active'
    && new Date(item.expiresAt || item.lockedUntil) > now
  )).length;
  return Math.max(memoryReservations, memoryHolds);
}

function reserveRoom(roomId, guest = {}, minutes = 10) {
  const room = store.state.rooms.find((item) => item.id === roomId);
  if (!room) throw new Error('Room not found');
  const activeReservations = roomActiveHoldCount(roomId);
  if (activeReservations >= Number(room.inventory || 0)) throw new Error('No room inventory available');
  const reservation = { id: `room-res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, roomId, guest, expiresAt: addMinutes(new Date(), minutes).toISOString(), createdAt: new Date().toISOString() };
  reservations.push(reservation);
  return reservation;
}

function isDuplicateKeyError(error) {
  return Boolean(error) && (error.code === 11000 || /E11000/.test(String(error.message || '')));
}

async function reserveRoomPersistent(roomId, guest = {}, minutes = 10, context = {}) {
  const now = new Date();
  const room = store.state.rooms.find((item) => item.id === roomId);
  if (!room) throw new Error('Room not found');
  if (repositories.mongoReady()) {
    // This count is only an advisory fast-path check: two concurrent requests can both
    // pass it before either hold is persisted. The InventoryHold model's unique partial
    // index on (roomId, holdType:'room', status:'active') is what actually makes the
    // reservation below atomic and closes that race - the try/catch handles the loser.
    const activeDbHolds = await repositories.inventoryHolds.count({ holdType: 'room', roomId, status: 'active', expiresAt: { $gt: now } });
    if (activeDbHolds >= Number(room.inventory || 0)) {
      const error = new Error('No room inventory available');
      error.status = 409;
      throw error;
    }
  }
  const reservation = reserveRoom(roomId, guest, minutes);
  try {
    await inventoryHoldService.recordRoomHold(reservation, context);
  } catch (error) {
    const index = reservations.indexOf(reservation);
    if (index >= 0) reservations.splice(index, 1);
    if (isDuplicateKeyError(error)) {
      const conflictError = new Error('Room is temporarily held by another checkout');
      conflictError.status = 409;
      throw conflictError;
    }
    throw error;
  }
  return reservation;
}

function releaseExpiredReservations(now = new Date()) {
  const before = reservations.length;
  for (let i = reservations.length - 1; i >= 0; i -= 1) {
    if (new Date(reservations[i].expiresAt) <= now) reservations.splice(i, 1);
  }
  (store.state.inventoryHolds || []).forEach((hold) => {
    if (hold.holdType === 'room' && hold.status === 'active' && new Date(hold.expiresAt || hold.lockedUntil) <= now) {
      hold.status = 'expired';
      hold.releasedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
      hold.releaseReason = 'expired';
    }
  });
  return before - reservations.length;
}

function consumeReservation(reservationId, roomId) {
  const reservation = findActiveReservation(reservationId, roomId);
  if (!reservation) return null;
  const index = reservations.indexOf(reservation);
  if (index >= 0) reservations.splice(index, 1);
  if (reservation.holdType === 'room') {
    reservation.status = 'consumed';
    reservation.consumedAt = new Date().toISOString();
  }
  return reservation;
}

module.exports = {
  reserveRoom,
  reserveRoomPersistent,
  releaseExpiredReservations,
  findActiveReservation,
  consumeReservation,
  reservations,
};

const store = require('../data/demoStore');
const { addMinutes } = require('../../utils/dates');

const reservations = [];

function findActiveReservation(reservationId, roomId) {
  const now = new Date();
  return reservations.find((item) => (
    item.id === reservationId
    && (!roomId || item.roomId === roomId)
    && new Date(item.expiresAt) > now
  ));
}

function reserveRoom(roomId, guest = {}, minutes = 10) {
  const room = store.state.rooms.find((item) => item.id === roomId);
  if (!room) throw new Error('Room not found');
  const activeReservations = reservations.filter((item) => item.roomId === roomId && new Date(item.expiresAt) > new Date()).length;
  if (activeReservations >= room.inventory) throw new Error('No room inventory available');
  const reservation = { id: `room-res-${reservations.length + 1}`, roomId, guest, expiresAt: addMinutes(new Date(), minutes).toISOString() };
  reservations.push(reservation);
  return reservation;
}

function releaseExpiredReservations(now = new Date()) {
  const before = reservations.length;
  for (let i = reservations.length - 1; i >= 0; i -= 1) {
    if (new Date(reservations[i].expiresAt) <= now) reservations.splice(i, 1);
  }
  return before - reservations.length;
}

function consumeReservation(reservationId, roomId) {
  const reservation = findActiveReservation(reservationId, roomId);
  if (!reservation) return null;
  const index = reservations.indexOf(reservation);
  if (index >= 0) reservations.splice(index, 1);
  return reservation;
}

module.exports = {
  reserveRoom,
  releaseExpiredReservations,
  findActiveReservation,
  consumeReservation,
  reservations,
};

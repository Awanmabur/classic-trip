const store = require('../data/demoStore');
const { addMinutes } = require('../../utils/dates');

function lockSeat(scheduleId, seatNumber, minutes = 10) {
  const seat = store.state.seats.find((item) => item.scheduleId === scheduleId && item.seatNumber === seatNumber);
  if (!seat) throw new Error('Seat not found');
  if (seat.status === 'taken') throw new Error('Seat is already taken');
  if (seat.lockedUntil && new Date(seat.lockedUntil) > new Date()) throw new Error('Seat is temporarily locked');
  const holdId = `seat-hold-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  seat.status = 'locked';
  seat.lockedUntil = addMinutes(new Date(), minutes).toISOString();
  seat.lockId = holdId;
  return { id: holdId, type: 'seat', scheduleId, seatNumber, lockedUntil: seat.lockedUntil, seat };
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

module.exports = { lockSeat, releaseExpiredLocks };

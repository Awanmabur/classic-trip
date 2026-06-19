const seatLockService = require('../services/booking/seatLockService');
const roomReservationService = require('../services/booking/roomReservationService');
const inventoryHoldService = require('../services/booking/inventoryHoldService');

async function run() {
  return {
    seats: await seatLockService.releaseExpiredLocksPersistent(),
    rooms: roomReservationService.releaseExpiredReservations(),
    holds: await inventoryHoldService.expireActiveHolds(),
  };
}

module.exports = { run };

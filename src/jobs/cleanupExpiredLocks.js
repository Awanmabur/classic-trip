const seatLockService = require('../services/booking/seatLockService');
const roomReservationService = require('../services/booking/roomReservationService');
const inventoryHoldService = require('../services/booking/inventoryHoldService');
const busInventoryService = require('../modules/bus/services/busInventoryService');

async function run() {
  return {
    seats: await seatLockService.releaseExpiredLocks(),
    rooms: await roomReservationService.releaseExpiredReservations(),
    holds: await inventoryHoldService.expireActiveHolds(),
    busSegmentHolds: await busInventoryService.expireStaleHolds(),
  };
}

module.exports = { run };

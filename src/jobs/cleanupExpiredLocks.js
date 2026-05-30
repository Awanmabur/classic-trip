const seatLockService = require('../services/booking/seatLockService');
const roomReservationService = require('../services/booking/roomReservationService');
function run() { return { seats: seatLockService.releaseExpiredLocks(), rooms: roomReservationService.releaseExpiredReservations() }; }
module.exports = { run };

const releaseService = require('../services/commission/releaseService');
const store = require('../services/data/demoStore');

function run() {
  return store.state.bookings.filter((booking) => booking.bookingStatus === 'completed').flatMap((booking) => releaseService.releaseCompletedBooking(booking.bookingRef) || []);
}
module.exports = { run };

const releaseService = require('../services/commission/releaseService');
const store = require('../services/data/persistentStore');

async function run() {
  const results = await Promise.all(
    store.state.bookings
      .filter((booking) => booking.bookingStatus === 'completed')
      .map((booking) => releaseService.releaseCompletedBooking(booking.bookingRef))
  );
  return results.flatMap((result) => result || []);
}
module.exports = { run };

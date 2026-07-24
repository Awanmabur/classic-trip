const releaseService = require('../services/commission/releaseService');
const financeRepository = require('../repositories/domain/financeRepository');
async function run() {
  const bookings = await financeRepository.bookings.list({ bookingStatus: { $in: ['completed', 'checked_in'] } }, { sort: { createdAt: 1 }, limit: 5000 });
  const results = [];
  for (const booking of bookings) results.push(...((await releaseService.releaseCompletedBooking(booking.bookingRef)) || []));
  return results;
}
module.exports = { run };

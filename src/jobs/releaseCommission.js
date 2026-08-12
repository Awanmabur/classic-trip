const releaseService = require('../services/commission/releaseService');
const financeRepository = require('../repositories/domain/financeRepository');
const { env } = require('../config/env');

async function run() {
  const bookings = await financeRepository.bookings.list({
    bookingStatus: { $in: ['completed', 'checked_in'] },
    $or: [
      { earningsReleasedAt: { $exists: false } },
      { earningsReleasedAt: null },
      { serviceType: 'flight', supplierPayableReleasedAt: { $exists: false } },
      { serviceType: 'flight', supplierPayableReleasedAt: null },
    ],
  }, { sort: { createdAt: 1 }, limit: env.jobs.commissionReleaseBatchSize });
  const results = [];
  for (const booking of bookings) {
    // eslint-disable-next-line no-await-in-loop
    results.push(...((await releaseService.releaseCompletedBooking(booking.bookingRef)) || []));
  }
  return { processed: bookings.length, released: results.length };
}
module.exports = { run };

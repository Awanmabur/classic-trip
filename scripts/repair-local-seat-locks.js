const { mongoose, connect } = require('../src/config/db');
const Seat = require('../src/models/Seat');
const TripSchedule = require('../src/models/TripSchedule');

async function main() {
  await connect();
  const now = new Date();
  const staleTaken = await Seat.updateMany(
    { status: 'taken', $or: [{ bookingRef: { $exists: false } }, { bookingRef: '' }, { bookingRef: null }] },
    { $set: { status: 'available' }, $unset: { lockedUntil: '', lockId: '', bookingRef: '', bookingId: '', passengerName: '', passengerPhone: '', passengerEmail: '' } }
  );
  const expiredLocks = await Seat.updateMany(
    { status: 'locked', lockedUntil: { $lte: now } },
    { $set: { status: 'available' }, $unset: { lockedUntil: '', lockId: '' } }
  );
  const scheduleIds = await Seat.distinct('scheduleId');
  let schedulesUpdated = 0;
  for (const id of scheduleIds) {
    const availableSeats = await Seat.countDocuments({ scheduleId: id, status: 'available' });
    await TripSchedule.updateOne({ id }, { $set: { availableSeats } });
    schedulesUpdated += 1;
  }
  console.log(JSON.stringify({ ok: true, staleTakenReleased: staleTaken.modifiedCount || 0, expiredLocksReleased: expiredLocks.modifiedCount || 0, schedulesUpdated }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(async () => {
  await mongoose.connection.close().catch(() => {});
});

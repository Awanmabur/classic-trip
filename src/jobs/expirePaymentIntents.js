const { mongoose } = require('../config/db');
const store = require('../services/data/persistentStore');
const inventoryHoldService = require('../services/booking/inventoryHoldService');

function mongoReady() {
  return mongoose.connection.readyState === 1;
}

async function releaseBookingInventory(booking = {}, reason = 'payment_intent_expired') {
  if (!booking) return { seats: 0, roomNights: 0, rooms: 0 };
  let seats = 0;
  let roomNights = 0;
  let rooms = 0;
  const now = new Date().toISOString();
  booking.bookingStatus = 'cancelled';
  booking.paymentStatus = booking.paymentStatus === 'successful' ? booking.paymentStatus : 'expired';
  booking.cancelReason = booking.cancelReason || reason;
  booking.cancelledAt = booking.cancelledAt || now;
  booking.ticketLegs = (booking.ticketLegs || []).map((leg) => ({ ...leg, status: leg.status === 'valid' ? 'cancelled' : leg.status, checkInStatus: 'cancelled', cancelledAt: now }));

  if (booking.serviceType === 'bus') {
    const claims = (booking.bookingItems || []).filter((item) => item.scheduleId && item.seatNumber);
    seats = claims.length;
    claims.forEach((claim) => {
      const seat = store.state.seats.find((row) => row.scheduleId === claim.scheduleId && row.seatNumber === claim.seatNumber);
      if (seat && seat.status === 'taken') {
        seat.status = 'available';
        seat.bookingRef = '';
        seat.lockedUntil = null;
        seat.lockId = null;
      }
      const schedule = store.state.schedules.find((row) => row.id === claim.scheduleId);
      if (schedule) schedule.availableSeats = Number(schedule.availableSeats || 0) + 1;
    });
    if (mongoReady() && claims.length) {
      const Seat = require('../models/Seat');
      const TripSchedule = require('../models/TripSchedule');
      await Seat.bulkWrite(claims.map((claim) => ({ updateOne: { filter: { scheduleId: claim.scheduleId, seatNumber: claim.seatNumber, bookingRef: booking.bookingRef }, update: { $set: { status: 'available', bookingRef: '' }, $unset: { lockedUntil: '', lockId: '' } } } })), { ordered: false });
      const counts = claims.reduce((acc, claim) => { acc[claim.scheduleId] = (acc[claim.scheduleId] || 0) + 1; return acc; }, {});
      await TripSchedule.bulkWrite(Object.entries(counts).map(([id, count]) => ({ updateOne: { filter: { id }, update: { $inc: { availableSeats: count } } } })), { ordered: false });
    }
  }

  if (booking.serviceType === 'hotel') {
    const nightIds = booking.hotelStay?.nightIds || (booking.bookingItems || []).flatMap((item) => item.nightIds || []);
    const roomId = booking.bookingItems?.[0]?.roomId || booking.bookingItems?.[0]?.roomUnitId || booking.hotelStay?.roomUnitIds?.[0];
    (store.state.roomNightInventories || []).forEach((night) => {
      if ((nightIds.length && nightIds.includes(night.id)) || night.bookingRef === booking.bookingRef) {
        night.status = 'open';
        night.bookingRef = '';
        night.guestName = '';
        night.checkInStatus = '';
        night.updatedAt = now;
        roomNights += 1;
      }
    });
    const room = store.state.rooms.find((row) => row.id === roomId);
    if (room) { room.inventory = Number(room.inventory || 0) + 1; rooms = 1; }
    if (mongoReady()) {
      const RoomNightInventory = require('../models/RoomNightInventory');
      const Room = require('../models/Room');
      const filter = nightIds.length ? { id: { $in: nightIds }, bookingRef: booking.bookingRef } : { bookingRef: booking.bookingRef };
      const result = await RoomNightInventory.updateMany(filter, { $inc: { availableInventory: 1 }, $set: { status: 'open', bookingRef: '', guestName: '', checkInStatus: '' }, $unset: { holdId: '' } });
      roomNights = Number(result.modifiedCount || result.nModified || roomNights || 0);
      if (roomId) { await Room.updateOne({ id: roomId }, { $inc: { inventory: 1 } }); rooms = 1; }
    }
  }

  return { seats, roomNights, rooms };
}

async function run() {
  const now = new Date();
  const result = { expiredIntents: 0, cancelledBookings: 0, seatsReleased: 0, roomNightsReleased: 0, roomsReleased: 0, holdsExpired: 0 };
  result.holdsExpired = await inventoryHoldService.expireActiveHolds();

  const inMemoryIntents = store.state.paymentIntents || [];
  for (const intent of inMemoryIntents) {
    if (['created', 'pending', 'processing'].includes(String(intent.status || '').toLowerCase()) && intent.expiresAt && new Date(intent.expiresAt) <= now) {
      intent.status = 'expired';
      intent.failedAt = now.toISOString();
      intent.failureReason = 'Payment intent expired before confirmation';
      result.expiredIntents += 1;
      const booking = store.findBooking(intent.bookingRef);
      if (booking && !['confirmed', 'checked_in', 'completed', 'refunded'].includes(String(booking.bookingStatus || '').toLowerCase())) {
        const released = await releaseBookingInventory(booking);
        result.cancelledBookings += 1;
        result.seatsReleased += released.seats;
        result.roomNightsReleased += released.roomNights;
        result.roomsReleased += released.rooms;
      }
    }
  }

  if (mongoReady()) {
    const PaymentIntent = require('../models/PaymentIntent');
    const Booking = require('../models/Booking');
    const expired = await PaymentIntent.find({ status: { $in: ['created', 'pending', 'processing'] }, expiresAt: { $lte: now } }).lean();
    for (const intent of expired) {
      await PaymentIntent.updateOne({ _id: intent._id }, { $set: { status: 'expired', failedAt: now, failureReason: 'Payment intent expired before confirmation' } });
      const booking = store.findBooking(intent.bookingRef) || await Booking.findOne({ bookingRef: intent.bookingRef }).lean();
      if (booking && !['confirmed', 'checked_in', 'completed', 'refunded'].includes(String(booking.bookingStatus || '').toLowerCase())) {
        const released = await releaseBookingInventory(booking);
        await Booking.updateOne({ bookingRef: booking.bookingRef }, { $set: { bookingStatus: 'cancelled', paymentStatus: 'expired', cancelReason: 'payment_intent_expired', cancelledAt: now, ticketLegs: booking.ticketLegs || [] } });
        result.cancelledBookings += 1;
        result.seatsReleased += released.seats;
        result.roomNightsReleased += released.roomNights;
        result.roomsReleased += released.rooms;
      }
    }
    result.expiredIntents = Math.max(result.expiredIntents, expired.length);
  }

  return result;
}

module.exports = { run, releaseBookingInventory };

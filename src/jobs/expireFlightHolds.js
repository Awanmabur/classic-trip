'use strict';
const repo = require('../modules/flight/repositories/flightRepository');

async function expireOrder(orderId) {
  return repo.withTransaction(async (session) => {
    const options = session ? { session } : {};
    const order = await repo.orders.findOne({ id: orderId }, options);
    if (!order || order.paymentStatus === 'successful' || order.status !== 'awaiting_payment') return { expired: false, released: 0 };
    const booking = await repo.bookings.findOne({ id: order.bookingId, companyId: order.companyId }, options);
    const result = await repo.seatInventory.updateMany(
      { orderId: order.id, status: 'held', heldUntil: { $lte: new Date() } },
      { $set: { status: 'available', orderId: '', travelerId: '', heldUntil: null, updatedAt: new Date() }, $inc: { version: 1 } },
      options
    );
    const released = Number(result?.modifiedCount ?? result?.nModified ?? 0);
    if (!released) return { expired: false, released: 0 };
    await repo.seatAssignments.updateMany({ orderId: order.id, status: 'held' }, { $set: { status: 'cancelled', updatedAt: new Date() } }, options);
    order.status = 'failed'; order.paymentStatus = 'expired'; order.ticketingStatus = 'not_requested'; order.updatedAt = new Date();
    await repo.orders.save(order, { id: order.id }, options);
    if (booking && booking.paymentStatus !== 'successful') {
      booking.bookingStatus = 'expired'; booking.paymentStatus = 'expired'; booking.notes = 'Flight seat hold expired before payment confirmation'; booking.updatedAt = new Date();
      await repo.bookings.save(booking, { id: booking.id }, options);
      await repo.bookingItems.updateMany({ bookingId: booking.id, serviceType: 'flight' }, { $set: { status: 'expired', updatedAt: new Date() } }, options);
    }
    await repo.outbox({ eventType: 'FlightSeatHoldExpired', aggregateType: 'flight_order', aggregateId: order.id, companyId: order.companyId, payload: { bookingRef: order.bookingRef, released }, session });
    return { expired: true, released };
  });
}

async function run() {
  const expiredSeats = await repo.seatInventory.list({ status: 'held', heldUntil: { $lte: new Date() }, orderId: { $nin: ['', null] } }, { limit: 2000 });
  const orderIds = [...new Set(expiredSeats.map((seat) => seat.orderId).filter(Boolean))];
  let expiredOrders = 0; let releasedSeats = 0;
  for (const orderId of orderIds) {
    const result = await expireOrder(orderId);
    if (result.expired) expiredOrders += 1;
    releasedSeats += result.released;
  }
  return { expiredOrders, releasedSeats };
}
module.exports = { run, expireOrder };

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

async function reconcileStaleFulfillment(orderId, cutoff = new Date(Date.now() - 10 * 60 * 1000)) {
  return repo.withTransaction(async (session) => {
    const options = session ? { session } : {};
    const order = await repo.orders.findOne({
      id: orderId,
      supplierFulfillmentStatus: 'in_progress',
      supplierFulfillmentStartedAt: { $lte: cutoff },
    }, options);
    if (!order) return { reconciled: false };
    const booking = await repo.bookings.findOne({ id: order.bookingId, companyId: order.companyId }, options);
    const reason = 'Supplier fulfillment stopped before a durable result was recorded; manual reconciliation is required';
    Object.assign(order, {
      status: 'reconciliation_required',
      ticketingStatus: 'failed',
      settlementStatus: 'reconciliation_required',
      supplierFulfillmentStatus: 'reconciliation_required',
      supplierFulfillmentError: reason,
      updatedAt: new Date(),
    });
    await repo.orders.save(order, { id: order.id }, options);
    if (booking) {
      Object.assign(booking, {
        paymentStatus: 'successful',
        bookingStatus: 'payment_processing',
        settlementStatus: 'reconciliation_required',
        settlementError: reason,
        updatedAt: new Date(),
      });
      await repo.bookings.save(booking, { id: booking.id }, options);
      await repo.bookingItems.updateMany({ bookingId: booking.id, serviceType: 'flight' }, { $set: { status: 'payment_processing', updatedAt: new Date() } }, options);
    }
    await repo.audit({ actorId: 'flight-fulfillment-job', action: 'flight.fulfillment.stale_reconciliation', targetType: 'flight_order', targetId: order.id, companyId: order.companyId, metadata: { bookingRef: order.bookingRef, reason }, session });
    return { reconciled: true };
  });
}

async function reconcileStaleCancellation(orderId, cutoff = new Date(Date.now() - 10 * 60 * 1000)) {
  return repo.withTransaction(async (session) => {
    const options = session ? { session } : {};
    const order = await repo.orders.findOne({ id: orderId, supplierCancellationStatus: 'in_progress', supplierCancellationStartedAt: { $lte: cutoff } }, options);
    if (!order) return { reconciled: false };
    const reason = 'Supplier cancellation stopped before a durable result was recorded; manual reconciliation is required';
    Object.assign(order, { status: 'reconciliation_required', settlementStatus: 'reconciliation_required', supplierCancellationStatus: 'reconciliation_required', supplierCancellationError: reason, updatedAt: new Date() });
    await repo.orders.save(order, { id: order.id }, options);
    await repo.bookings.updateOne({ id: order.bookingId, companyId: order.companyId }, { $set: { settlementStatus: 'reconciliation_required', settlementError: reason, updatedAt: new Date() } }, options);
    await repo.audit({ actorId: 'flight-fulfillment-job', action: 'flight.cancellation.stale_reconciliation', targetType: 'flight_order', targetId: order.id, companyId: order.companyId, metadata: { bookingRef: order.bookingRef, reason }, session });
    return { reconciled: true };
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
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  const staleFulfillments = await repo.orders.list({ supplierFulfillmentStatus: 'in_progress', supplierFulfillmentStartedAt: { $lte: cutoff } }, { limit: 200 });
  let fulfillmentReconciliations = 0;
  for (const order of staleFulfillments) {
    const result = await reconcileStaleFulfillment(order.id, cutoff);
    if (result.reconciled) fulfillmentReconciliations += 1;
  }
  const staleCancellations = await repo.orders.list({ supplierCancellationStatus: 'in_progress', supplierCancellationStartedAt: { $lte: cutoff } }, { limit: 200 });
  let cancellationReconciliations = 0;
  for (const order of staleCancellations) {
    const result = await reconcileStaleCancellation(order.id, cutoff);
    if (result.reconciled) cancellationReconciliations += 1;
  }
  return { expiredOrders, releasedSeats, fulfillmentReconciliations, cancellationReconciliations };
}
module.exports = { run, expireOrder, reconcileStaleFulfillment, reconcileStaleCancellation };

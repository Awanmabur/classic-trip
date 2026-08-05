const crypto = require('crypto');
const platformRepository = require('../../repositories/domain/platformRepository');
const commerceRepository = require('../../repositories/domain/commerceRepository');
const notificationService = require('../notification/notificationService');
const sensitiveFieldService = require('../security/sensitiveFieldService');

function auditId() {
  return `audit-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

async function writeAudit(payload = {}) {
  const row = {
    id: payload.id || auditId(),
    actorId: payload.actorId || 'system',
    actorName: payload.actorName || '',
    actorEmail: payload.actorEmail || '',
    actorRole: payload.actorRole || 'guest',
    action: payload.action || 'system.event',
    entityType: payload.entityType || payload.targetType || 'system',
    entityId: payload.entityId || payload.targetId || '',
    targetType: payload.targetType || payload.entityType || 'system',
    targetId: payload.targetId || payload.entityId || '',
    target: payload.target || payload.targetId || payload.entityId || '',
    status: payload.status || 'success',
    metadata: payload.metadata || payload.meta || {},
    meta: payload.meta || payload.metadata || {},
    createdAt: payload.createdAt || new Date().toISOString(),
  };
  await platformRepository.auditLogs.save(row, { id: row.id });
  return { auditId: row.id };
}

// These domain events are durable integration facts. Classic Trip does not
// currently have an external subscriber for them, so acknowledge them once
// instead of retrying each event eight times and loading the MongoDB pool.
async function acknowledgeDomainFact(payload = {}, event = {}) {
  return {
    acknowledged: true,
    aggregateType: event.aggregateType || '',
    aggregateId: event.aggregateId || '',
    payloadRecorded: Boolean(payload && Object.keys(payload).length),
  };
}

function requireSuccessfulDelivery(rows = []) {
  const failed = rows.filter((row) => row.deliveryStatus === 'failed' || row.status === 'failed');
  if (failed.length) {
    const error = new Error(`Notification delivery failed for ${failed.map((row) => row.channel).join(', ')}`);
    error.code = 'notification_delivery_failed';
    throw error;
  }
  return rows;
}

async function recordReminderDelivery(request = {}) {
  if (request.referenceType !== 'booking_reminder' || !request.referenceId) return;
  await commerceRepository.bookings.updateOne(
    { id: request.referenceId },
    { $set: { reminderSentAt: new Date(), reminderDeliveryStatus: 'sent' } },
  );
}

async function bookingNotification(payload = {}, event = {}) {
  const booking = await commerceRepository.bookings.findOne({
    $or: [
      { id: event.aggregateId || '' },
      { bookingRef: payload.bookingRef || '' },
    ],
  });
  if (!booking) throw new Error(`Booking ${payload.bookingRef || event.aggregateId || ''} was not found for notification`);
  const rows = await notificationService.bookingConfirmed(booking);
  requireSuccessfulDelivery(rows);
  return { notificationIds: rows.map((row) => row.id), bookingRef: booking.bookingRef };
}

async function flightScheduleNotification(payload = {}, event = {}) {
  const bookings = await commerceRepository.bookings.list({
    serviceType: 'flight',
    'bookingLegs.departureId': event.aggregateId,
    bookingStatus: { $in: ['confirmed', 'in_progress'] },
  }, { limit: 2000 });
  const rows = [];
  for (const booking of bookings) {
    // eslint-disable-next-line no-await-in-loop
    const queued = await notificationService.queueNotification({
      userId: booking.customerUserId || null,
      channels: ['in_app', 'push', 'email'],
      title: `Flight update ${booking.bookingRef}`,
      message: `Your flight status is now ${payload.status || 'updated'}${payload.delayMinutes ? ` with a ${payload.delayMinutes}-minute delay` : ''}${payload.gate ? `. Gate ${payload.gate}` : ''}.`,
      recipient: {
        email: booking.guestSnapshot?.email,
        phone: booking.guestSnapshot?.phone,
        name: booking.guestSnapshot?.fullName,
      },
      referenceType: 'flight_departure',
      referenceId: event.aggregateId,
      dedupeKey: `outbox:${event.id}:${booking.id}`,
      meta: { bookingRef: booking.bookingRef, companyId: booking.companyId, ...payload },
    });
    rows.push(...queued);
  }
  requireSuccessfulDelivery(rows);
  return { notificationIds: rows.map((row) => row.id), bookingsNotified: bookings.length };
}

async function flightHoldExpiredNotification(payload = {}, event = {}) {
  const booking = payload.bookingRef
    ? await commerceRepository.bookings.findOne({ bookingRef: payload.bookingRef })
    : null;
  if (!booking) return acknowledgeDomainFact(payload, event);
  const rows = await notificationService.queueNotification({
    userId: booking.customerUserId || null,
    channels: ['in_app', 'email'],
    title: `Flight hold expired ${booking.bookingRef}`,
    message: `The flight seat hold for booking ${booking.bookingRef} expired before payment was confirmed. Search again to choose current availability.`,
    recipient: { email: booking.guestSnapshot?.email, phone: booking.guestSnapshot?.phone, name: booking.guestSnapshot?.fullName },
    referenceType: 'flight_booking',
    referenceId: booking.id,
    dedupeKey: `outbox:${event.id}:${booking.id}`,
    meta: { bookingRef: booking.bookingRef, releasedSeats: payload.released || 0 },
  });
  requireSuccessfulDelivery(rows);
  return { notificationIds: rows.map((row) => row.id), bookingRef: booking.bookingRef };
}

async function taxiIncidentNotification(payload = {}, event = {}) {
  const rows = await notificationService.queueNotification({
    channels: ['in_app'],
    title: `Mobility incident ${payload.severity || 'reported'}`,
    message: `A customer reported a ${payload.category || 'ride'} incident for ${payload.bookingRef || payload.rideId || event.aggregateId}.`,
    ownerType: 'platform',
    ownerId: 'operations',
    audience: 'operations',
    referenceType: 'taxi_incident',
    referenceId: event.aggregateId,
    dedupeKey: `outbox:${event.id}:operations`,
    meta: { companyId: event.companyId || '', ...payload },
  });
  requireSuccessfulDelivery(rows);
  return { notificationIds: rows.map((row) => row.id) };
}

async function expireDomainBooking(payload = {}) {
  const booking = await commerceRepository.bookings.findOne({ bookingRef: payload.bookingRef });
  if (!booking || String(booking.paymentStatus || '').toLowerCase() === 'successful') {
    return { ignored: true, reason: booking ? 'payment_already_successful' : 'booking_already_cleaned' };
  }
  const serviceType = String(payload.serviceType || booking.serviceType || '').toLowerCase();
  if (serviceType === 'bus') {
    const service = require('../../modules/bus/services/busBookingService');
    await service.failPayment(booking.bookingRef, payload.reason || 'Payment intent expired', { source: 'payment_intent_expiry' });
    return { cleaned: true, serviceType, bookingRef: booking.bookingRef, bookingPurged: true };
  }
  if (serviceType === 'flight') {
    const service = require('../../modules/flight/services/flightBookingService');
    const updated = await service.failPayment(booking.bookingRef, payload.reason || 'Payment intent expired', { source: 'payment_intent_expiry' });
    return { cleaned: true, serviceType, bookingRef: updated?.bookingRef || booking.bookingRef };
  }
  if (serviceType === 'local_transport') {
    const service = require('../../modules/taxi/services/taxiRideService');
    const updated = await service.failPayment(booking.bookingRef, payload.reason || 'Payment intent expired', { source: 'payment_intent_expiry' });
    return { cleaned: true, serviceType, bookingRef: updated?.bookingRef || booking.bookingRef };
  }
  return { ignored: true, reason: 'unsupported_domain_service', serviceType };
}

const handlers = {
  'notification.secure_requested': async (payload, event = {}) => {
    const decrypted = sensitiveFieldService.decrypt(payload.encrypted, 'outbox-notification');
    if (!decrypted) throw new Error('Secure notification payload could not be decrypted');
    const request = JSON.parse(decrypted);
    const rows = await notificationService.queueNotification({ ...request, dedupeKey: request.dedupeKey || `outbox:${event.id}` });
    requireSuccessfulDelivery(rows);
    await recordReminderDelivery(request);
    return { notificationIds: rows.map((row) => row.id) };
  },
  'notification.requested': async (payload, event = {}) => {
    const rows = await notificationService.queueNotification({ ...payload, dedupeKey: payload.dedupeKey || `outbox:${event.id}` });
    requireSuccessfulDelivery(rows);
    await recordReminderDelivery(payload);
    return { notificationIds: rows.map((row) => row.id) };
  },
  BusBookingConfirmed: bookingNotification,
  ScheduleRuleMaterializationRequested: async (payload = {}, event = {}) => {
    // Keep the expensive month of departure/inventory creation in the worker.
    // The partner request only stores the rule and redirects immediately.
    const materializer = require('../../jobs/materializeSchedules');
    return materializer.materializeRuleById(
      payload.companyId || event.companyId,
      payload.ruleId || event.aggregateId,
    );
  },
  BusListingPublished: acknowledgeDomainFact,
  BusDeparturePublished: acknowledgeDomainFact,
  BusBookingCreated: acknowledgeDomainFact,
  BusBookingCancelled: acknowledgeDomainFact,
  BusBookingRefunded: acknowledgeDomainFact,
  BusInventoryHeld: acknowledgeDomainFact,
  BusInventoryBooked: acknowledgeDomainFact,
  BusInventoryHoldExpired: acknowledgeDomainFact,
  BusInventoryReleased: acknowledgeDomainFact,
  BusPassengerCheckedIn: acknowledgeDomainFact,
  BusIncidentReported: acknowledgeDomainFact,
  BusDepartureActive: acknowledgeDomainFact,
  BusDepartureBoarding: acknowledgeDomainFact,
  BusDepartureDelayed: acknowledgeDomainFact,
  BusDepartureDeparted: acknowledgeDomainFact,
  BusDepartureArrived: acknowledgeDomainFact,
  BusDepartureCompleted: acknowledgeDomainFact,
  BusDepartureCancelled: acknowledgeDomainFact,
  BusDepartureArchived: acknowledgeDomainFact,
  FlightTicketIssued: bookingNotification,
  FlightOrderRefunded: acknowledgeDomainFact,
  FlightScheduleChanged: flightScheduleNotification,
  FlightSeatHoldExpired: flightHoldExpiredNotification,
  TaxiRidePaymentConfirmed: bookingNotification,
  TaxiRideRefunded: acknowledgeDomainFact,
  TaxiCustomerIncidentReported: taxiIncidentNotification,
  PaymentIntentExpired: expireDomainBooking,
  'audit.write': writeAudit,
};

module.exports = {
  handlers,
  writeAudit,
  acknowledgeDomainFact,
  bookingNotification,
  flightScheduleNotification,
  flightHoldExpiredNotification,
  taxiIncidentNotification,
  expireDomainBooking,
  requireSuccessfulDelivery,
  recordReminderDelivery,
};

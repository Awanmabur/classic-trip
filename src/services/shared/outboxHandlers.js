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

const handlers = {
  'notification.secure_requested': async (payload) => {
    const decrypted = sensitiveFieldService.decrypt(payload.encrypted, 'outbox-notification');
    if (!decrypted) throw new Error('Secure notification payload could not be decrypted');
    const request = JSON.parse(decrypted);
    const rows = await notificationService.queueNotification(request);
    return { notificationIds: rows.map((row) => row.id) };
  },
  'notification.requested': async (payload) => {
    const rows = await notificationService.queueNotification(payload);
    return { notificationIds: rows.map((row) => row.id) };
  },
  BusBookingConfirmed: async (payload = {}, event = {}) => {
    const booking = await commerceRepository.bookings.findOne({
      $or: [
        { id: event.aggregateId || '' },
        { bookingRef: payload.bookingRef || '' },
      ],
    });
    if (!booking) throw new Error(`Confirmed bus booking ${payload.bookingRef || event.aggregateId || ''} was not found`);
    const rows = await notificationService.bookingConfirmed(booking);
    return { notificationIds: rows.map((row) => row.id), bookingRef: booking.bookingRef };
  },
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
  BusPassengerCheckedIn: acknowledgeDomainFact,
  BusIncidentReported: acknowledgeDomainFact,
  'audit.write': writeAudit,
};

module.exports = { handlers, writeAudit, acknowledgeDomainFact };

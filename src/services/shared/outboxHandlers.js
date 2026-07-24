const crypto = require('crypto');
const platformRepository = require('../../repositories/domain/platformRepository');
const commerceRepository = require('../../repositories/domain/commerceRepository');
const notificationService = require('../notification/notificationService');

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

const handlers = {
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
  'audit.write': writeAudit,
};

module.exports = { handlers, writeAudit };

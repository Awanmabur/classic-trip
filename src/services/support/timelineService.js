const store = require('../data/persistentStore');
const notificationService = require('../notification/notificationService');
const { mongoose } = require('../../config/db');

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

function normalize(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, '_');
}

function ensureCollections() {
  if (!Array.isArray(store.state.bookingTimelineEvents)) store.state.bookingTimelineEvents = [];
  if (!Array.isArray(store.state.rescheduleRequests)) store.state.rescheduleRequests = [];
  if (!Array.isArray(store.state.supportTickets)) store.state.supportTickets = [];
  if (!Array.isArray(store.state.correspondenceMessages)) store.state.correspondenceMessages = [];
  if (!Array.isArray(store.state.notificationDeliveryAttempts)) store.state.notificationDeliveryAttempts = [];
  if (!Array.isArray(store.state.refundRequests)) store.state.refundRequests = [];
  if (!Array.isArray(store.state.auditLogs)) store.state.auditLogs = [];
}

function nextId(prefix, rows) {
  let index = rows.length + 1;
  let id = `${prefix}-${index}`;
  while (rows.some((row) => row.id === id)) {
    index += 1;
    id = `${prefix}-${index}`;
  }
  return id;
}

async function persist(modelName, row, filter = { id: row.id }) {
  if (mongoose.connection.readyState !== 1 || !row) return;
  const Model = require(`../../models/${modelName}`);
  await Model.updateOne(filter, { $set: row }, { upsert: true, runValidators: true });
}

function audit(actorId, action, target, meta = {}) {
  ensureCollections();
  const entry = {
    id: nextId('audit', store.state.auditLogs),
    actorId: actorId || 'support-system',
    action,
    target,
    meta,
    createdAt: new Date().toISOString(),
  };
  store.state.auditLogs.push(entry);
  return entry;
}

async function recordEvent(payload = {}) {
  ensureCollections();
  const booking = payload.bookingRef ? store.findBooking(payload.bookingRef) : null;
  const event = {
    id: nextId('timeline', store.state.bookingTimelineEvents),
    bookingId: payload.bookingId || booking?.id || '',
    bookingRef: payload.bookingRef || booking?.bookingRef || '',
    companyId: payload.companyId || booking?.companyId || '',
    customerUserId: payload.customerUserId || booking?.customerUserId || '',
    entityType: cleanText(payload.entityType || 'support'),
    entityId: cleanText(payload.entityId || ''),
    action: normalize(payload.action || 'updated'),
    title: cleanText(payload.title || payload.action || 'Timeline update'),
    message: cleanText(payload.message || ''),
    status: normalize(payload.status || 'open'),
    visibility: normalize(payload.visibility || 'shared'),
    actorType: normalize(payload.actorType || 'system'),
    actorId: cleanText(payload.actorId || 'support-system'),
    actorName: cleanText(payload.actorName || payload.actorId || 'Classic Trip'),
    metadata: payload.metadata || {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.state.bookingTimelineEvents.unshift(event);
  await persist('BookingTimelineEvent', event);
  return event;
}

function bookingTimeline(bookingRef, { includeInternal = false } = {}) {
  ensureCollections();
  return store.state.bookingTimelineEvents
    .filter((event) => event.bookingRef === bookingRef)
    .map((event) => {
      if (!event.action) event.action = normalize(event.eventType || event.type || event.title || 'timeline.updated');
      return event;
    })
    .filter((event) => includeInternal || event.visibility !== 'internal')
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function ticketTimeline(ticketId, { includeInternal = false } = {}) {
  ensureCollections();
  const ticket = store.state.supportTickets.find((row) => row.id === ticketId) || {};
  return store.state.bookingTimelineEvents
    .filter((event) => event.entityId === ticketId || (ticket.bookingRef && event.bookingRef === ticket.bookingRef))
    .filter((event) => includeInternal || event.visibility !== 'internal')
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

async function attachSupportEvent(ticket, payload = {}) {
  if (!ticket) return null;
  return recordEvent({
    bookingRef: ticket.bookingRef,
    companyId: ticket.companyId,
    entityType: 'support_ticket',
    entityId: ticket.id,
    action: payload.action || 'support.ticket.updated',
    title: payload.title || ticket.subject || 'Support update',
    message: payload.message || ticket.message || '',
    status: payload.status || ticket.status || 'open',
    actorType: payload.actorType || 'support',
    actorId: payload.actorId || ticket.createdBy || 'support-system',
    actorName: payload.actorName || payload.actorId || 'Support team',
    visibility: payload.visibility || 'shared',
    metadata: { priority: ticket.priority, category: ticket.category, ...payload.metadata },
  });
}

async function replySupportTicket({ ticketId, actorType = 'support', actorId = 'support-system', message, status, visibility = 'shared' } = {}) {
  ensureCollections();
  const ticket = store.state.supportTickets.find((row) => row.id === ticketId);
  if (!ticket) {
    const error = new Error('Support ticket not found');
    error.status = 404;
    throw error;
  }
  const cleanMessage = cleanText(message);
  if (!cleanMessage) {
    const error = new Error('Support reply is required');
    error.status = 422;
    throw error;
  }
  const reply = {
    id: nextId('reply', ticket.replies || []),
    actorType: normalize(actorType),
    actorId: cleanText(actorId),
    message: cleanMessage,
    status: normalize(status || ticket.status || 'open'),
    visibility: normalize(visibility || 'shared'),
    createdAt: new Date().toISOString(),
  };
  ticket.replies = Array.isArray(ticket.replies) ? ticket.replies : [];
  ticket.replies.push(reply);
  ticket.lastResponse = cleanMessage;
  ticket.respondedBy = actorId;
  ticket.respondedAt = reply.createdAt;
  ticket.status = reply.status;
  ticket.updatedAt = reply.createdAt;
  if (['closed', 'resolved'].includes(reply.status)) {
    ticket.resolvedBy = actorId;
    ticket.resolvedAt = reply.createdAt;
    ticket.resolutionNotes = cleanMessage;
  }
  await persist('SupportTicket', ticket);
  await attachSupportEvent(ticket, {
    action: 'support.reply.added',
    title: `Support reply for ${ticket.id}`,
    message: cleanMessage,
    status: ticket.status,
    actorType,
    actorId,
    visibility,
  });
  const correspondenceService = require('./correspondenceService');
  await correspondenceService.linkToSupportTicket(ticket, {
    message: cleanMessage,
    status: ticket.status,
    actorType,
    actorId,
    visibility,
    direction: actorType === 'customer' ? 'inbound' : 'outbound',
    channels: visibility === 'internal' ? [] : ['in_app', 'email', 'sms', 'whatsapp'],
    metadata: { replyId: reply.id, source: 'support_reply' },
  });
  audit(actorId, 'support.reply.added', ticket.id, { bookingRef: ticket.bookingRef, status: ticket.status });
  if (ticket.bookingRef) {
    await notificationService.queueNotification({
      userId: ticket.ownerId || ticket.userId || null,
      channels: ['email', 'sms'],
      title: `Support update ${ticket.bookingRef}`,
      message: cleanMessage,
      referenceType: 'support_ticket',
      referenceId: ticket.id,
      meta: { bookingRef: ticket.bookingRef, status: ticket.status },
    }).catch(() => {});
  }
  return ticket;
}

async function requestReschedule({ bookingRef, requesterId = 'customer', preferredDate, preferredTime, requestedScheduleId, reason = '' } = {}) {
  ensureCollections();
  const booking = store.findBooking(bookingRef);
  if (!booking) {
    const error = new Error('Booking not found');
    error.status = 404;
    throw error;
  }
  const existing = store.state.rescheduleRequests.find((row) => row.bookingRef === booking.bookingRef && row.status === 'pending');
  if (existing) {
    const hasRequestedEvent = store.state.bookingTimelineEvents.some((event) => event.bookingRef === booking.bookingRef && event.action === 'reschedule.requested' && event.entityId === existing.id);
    if (!hasRequestedEvent) {
      await recordEvent({
        bookingRef: booking.bookingRef,
        companyId: booking.companyId,
        entityType: 'reschedule_request',
        entityId: existing.id,
        action: 'reschedule.requested',
        title: `Reschedule requested for ${booking.bookingRef}`,
        message: existing.reason || reason || 'Customer requested reschedule',
        status: existing.status || 'pending',
        actorType: 'customer',
        actorId: requesterId,
        metadata: { preferredDate: existing.preferredDate, preferredTime: existing.preferredTime },
      });
    }
    return existing;
  }
  const request = {
    id: nextId('reschedule', store.state.rescheduleRequests),
    bookingId: booking.id,
    bookingRef: booking.bookingRef,
    companyId: booking.companyId,
    customerUserId: booking.customerUserId || '',
    requesterId: cleanText(requesterId),
    currentScheduleId: booking.scheduleId || '',
    requestedScheduleId: cleanText(requestedScheduleId || ''),
    preferredDate: preferredDate ? new Date(preferredDate).toISOString() : '',
    preferredTime: cleanText(preferredTime || ''),
    reason: cleanText(reason || 'Customer requested reschedule'),
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.state.rescheduleRequests.unshift(request);
  const ticket = {
    id: nextId('support', store.state.supportTickets),
    ownerType: 'customer',
    ownerId: requesterId,
    companyId: booking.companyId,
    bookingId: booking.id,
    bookingRef: booking.bookingRef,
    category: 'Reschedule request',
    subject: `Reschedule request ${booking.bookingRef}`,
    message: request.reason,
    priority: 'medium',
    status: 'open',
    assignedTo: 'support',
    createdBy: requesterId,
    metadata: { rescheduleRequestId: request.id, preferredDate: request.preferredDate, preferredTime: request.preferredTime, requestedScheduleId: request.requestedScheduleId },
    createdAt: request.createdAt,
  };
  store.state.supportTickets.unshift(ticket);
  await persist('RescheduleRequest', request);
  await persist('SupportTicket', ticket);
  await recordEvent({
    bookingRef: booking.bookingRef,
    companyId: booking.companyId,
    entityType: 'reschedule_request',
    entityId: request.id,
    action: 'reschedule.requested',
    title: `Reschedule requested for ${booking.bookingRef}`,
    message: request.reason,
    status: 'pending',
    actorType: 'customer',
    actorId: requesterId,
    metadata: { preferredDate: request.preferredDate, preferredTime: request.preferredTime, supportTicketId: ticket.id },
  });
  audit(requesterId, 'reschedule.requested', request.id, { bookingRef: booking.bookingRef });
  return request;
}

async function reviewReschedule(requestId, { status = 'approved', actorId = 'admin-system', approvedScheduleId = '', reviewNote = '' } = {}) {
  ensureCollections();
  const request = store.state.rescheduleRequests.find((row) => row.id === requestId || row.bookingRef === requestId);
  if (!request) {
    const error = new Error('Reschedule request not found');
    error.status = 404;
    throw error;
  }
  if (request.status !== 'pending') return request;
  const booking = store.findBooking(request.bookingRef);
  const normalized = normalize(status) === 'approved' ? 'approved' : 'rejected';
  request.status = normalized;
  request.reviewedBy = actorId;
  request.reviewedAt = new Date().toISOString();
  request.reviewNote = cleanText(reviewNote || (normalized === 'approved' ? 'Reschedule approved' : 'Reschedule rejected'));
  request.approvedScheduleId = normalized === 'approved' ? cleanText(approvedScheduleId || request.requestedScheduleId || request.currentScheduleId || '') : '';
  request.updatedAt = request.reviewedAt;
  if (normalized === 'approved' && booking) {
    const previousScheduleId = booking.scheduleId;
    if (request.approvedScheduleId) booking.scheduleId = request.approvedScheduleId;
    booking.bookingStatus = 'rescheduled';
    booking.rescheduledAt = request.reviewedAt;
    booking.previousScheduleId = previousScheduleId;
    request.appliedAt = request.reviewedAt;
  }
  const ticket = store.state.supportTickets.find((row) => row.metadata?.rescheduleRequestId === request.id || row.subject === `Reschedule request ${request.bookingRef}`);
  if (ticket) {
    ticket.status = normalized === 'approved' ? 'resolved' : 'closed';
    ticket.resolutionNotes = request.reviewNote;
    ticket.resolvedBy = actorId;
    ticket.resolvedAt = request.reviewedAt;
    ticket.updatedAt = request.reviewedAt;
    await persist('SupportTicket', ticket);
  }
  await persist('RescheduleRequest', request);
  if (booking) await persist('Booking', booking, { bookingRef: booking.bookingRef });
  await recordEvent({
    bookingRef: request.bookingRef,
    companyId: request.companyId,
    entityType: 'reschedule_request',
    entityId: request.id,
    action: normalized === 'approved' ? 'reschedule.approved' : 'reschedule.rejected',
    title: normalized === 'approved' ? `Reschedule approved for ${request.bookingRef}` : `Reschedule rejected for ${request.bookingRef}`,
    message: request.reviewNote,
    status: normalized,
    actorType: 'admin',
    actorId,
    metadata: { approvedScheduleId: request.approvedScheduleId, supportTicketId: ticket?.id || '' },
  });
  audit(actorId, `reschedule.${normalized}`, request.id, { bookingRef: request.bookingRef });
  return request;
}

module.exports = {
  recordEvent,
  bookingTimeline,
  ticketTimeline,
  attachSupportEvent,
  replySupportTicket,
  requestReschedule,
  reviewReschedule,
};

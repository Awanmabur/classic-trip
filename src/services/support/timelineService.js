const supportRepository = require('../../repositories/domain/supportRepository');
const notificationService = require('../notification/notificationService');
const { nextId } = require('../data/idService');

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}
function normalize(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, '_');
}
async function audit(actorId, action, target, meta = {}) {
  const entry = {
    id: await nextId('audit'), actorId: actorId || 'support-system', action, target, meta,
    createdAt: new Date().toISOString(),
  };
  await supportRepository.auditLogs.save(entry, { id: entry.id });
  return entry;
}

async function recordEvent(payload = {}) {
  const booking = payload.bookingRef ? await supportRepository.bookings.findOne({ $or: [{ bookingRef: payload.bookingRef }, { id: payload.bookingRef }] }) : null;
  const now = new Date().toISOString();
  const event = {
    id: await nextId('timeline'),
    bookingId: payload.bookingId || booking?.id || '', bookingRef: payload.bookingRef || booking?.bookingRef || '',
    companyId: payload.companyId || booking?.companyId || '', customerUserId: payload.customerUserId || booking?.customerUserId || '',
    entityType: cleanText(payload.entityType || 'support'), entityId: cleanText(payload.entityId || ''),
    action: normalize(payload.action || 'updated'), title: cleanText(payload.title || payload.action || 'Timeline update'),
    message: cleanText(payload.message || ''), status: normalize(payload.status || 'open'),
    visibility: normalize(payload.visibility || 'shared'), actorType: normalize(payload.actorType || 'system'),
    actorId: cleanText(payload.actorId || 'support-system'), actorName: cleanText(payload.actorName || payload.actorId || 'Classic Trip'),
    metadata: payload.metadata || {}, createdAt: now, updatedAt: now,
  };
  await supportRepository.timelineEvents.save(event, { id: event.id });
  return event;
}

async function bookingTimeline(bookingRef, { includeInternal = false } = {}) {
  return (await supportRepository.timelineEvents.list({ bookingRef }))
    .map((event) => ({ ...event, action: event.action || normalize(event.eventType || event.type || event.title || 'timeline.updated') }))
    .filter((event) => includeInternal || event.visibility !== 'internal')
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

async function ticketTimeline(ticketId, { includeInternal = false } = {}) {
  const ticket = await supportRepository.tickets.findOne({ id: ticketId }) || {};
  return (await supportRepository.timelineEvents.list({}))
    .filter((event) => event.entityId === ticketId || (ticket.bookingRef && event.bookingRef === ticket.bookingRef))
    .filter((event) => includeInternal || event.visibility !== 'internal')
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

async function attachSupportEvent(ticket, payload = {}) {
  if (!ticket) return null;
  return recordEvent({
    bookingRef: ticket.bookingRef, companyId: ticket.companyId, entityType: 'support_ticket', entityId: ticket.id,
    action: payload.action || 'support.ticket.updated', title: payload.title || ticket.subject || 'Support update',
    message: payload.message || ticket.message || '', status: payload.status || ticket.status || 'open',
    actorType: payload.actorType || 'support', actorId: payload.actorId || ticket.createdBy || 'support-system',
    actorName: payload.actorName || payload.actorId || 'Support team', visibility: payload.visibility || 'shared',
    metadata: { priority: ticket.priority, category: ticket.category, ...payload.metadata },
  });
}

async function replySupportTicket({ ticketId, actorType = 'support', actorId = 'support-system', message, status, visibility = 'shared' } = {}) {
  const ticket = await supportRepository.tickets.findOne({ id: ticketId });
  if (!ticket) { const error = new Error('Support ticket not found'); error.status = 404; throw error; }
  const cleanMessage = cleanText(message);
  if (!cleanMessage) { const error = new Error('Support reply is required'); error.status = 422; throw error; }
  const now = new Date().toISOString();
  const reply = {
    id: await nextId('reply'), actorType: normalize(actorType), actorId: cleanText(actorId), message: cleanMessage,
    status: normalize(status || ticket.status || 'open'), visibility: normalize(visibility || 'shared'), createdAt: now,
  };
  ticket.replies = Array.isArray(ticket.replies) ? ticket.replies : [];
  ticket.replies.push(reply);
  Object.assign(ticket, { lastResponse: cleanMessage, respondedBy: actorId, respondedAt: now, status: reply.status, updatedAt: now });
  if (['closed', 'resolved'].includes(reply.status)) Object.assign(ticket, { resolvedBy: actorId, resolvedAt: now, resolutionNotes: cleanMessage });
  await supportRepository.tickets.save(ticket, { id: ticket.id });
  await attachSupportEvent(ticket, { action: 'support.reply.added', title: `Support reply for ${ticket.id}`, message: cleanMessage, status: ticket.status, actorType, actorId, visibility });
  const correspondenceService = require('./correspondenceService');
  await correspondenceService.linkToSupportTicket(ticket, {
    message: cleanMessage, status: ticket.status, actorType, actorId, visibility,
    direction: actorType === 'customer' ? 'inbound' : 'outbound',
    channels: visibility === 'internal' ? [] : ['in_app', 'email', 'sms', 'whatsapp'],
    metadata: { replyId: reply.id, source: 'support_reply' },
  });
  await audit(actorId, 'support.reply.added', ticket.id, { bookingRef: ticket.bookingRef, status: ticket.status });
  if (ticket.bookingRef) {
    await notificationService.queueNotification({
      userId: ticket.ownerId || ticket.userId || null, channels: ['email', 'sms'], title: `Support update ${ticket.bookingRef}`,
      message: cleanMessage, referenceType: 'support_ticket', referenceId: ticket.id,
      meta: { bookingRef: ticket.bookingRef, status: ticket.status },
    }).catch(() => {});
  }
  return ticket;
}

async function requestReschedule({ bookingRef, requesterId = 'customer', preferredDate, preferredTime, requestedScheduleId, reason = '' } = {}) {
  const booking = await supportRepository.bookings.findOne({ $or: [{ bookingRef }, { id: bookingRef }] });
  if (!booking) { const error = new Error('Booking not found'); error.status = 404; throw error; }
  const existing = await supportRepository.rescheduleRequests.findOne({ bookingRef: booking.bookingRef, status: 'pending' });
  if (existing) {
    const hasEvent = Boolean(await supportRepository.timelineEvents.findOne({ bookingRef: booking.bookingRef, action: 'reschedule.requested', entityId: existing.id }));
    if (!hasEvent) await recordEvent({ bookingRef: booking.bookingRef, companyId: booking.companyId, entityType: 'reschedule_request', entityId: existing.id, action: 'reschedule.requested', title: `Reschedule requested for ${booking.bookingRef}`, message: existing.reason || reason || 'Customer requested reschedule', status: existing.status || 'pending', actorType: 'customer', actorId: requesterId, metadata: { preferredDate: existing.preferredDate, preferredTime: existing.preferredTime } });
    return existing;
  }
  const now = new Date().toISOString();
  const request = {
    id: await nextId('reschedule'), bookingId: booking.id, bookingRef: booking.bookingRef, companyId: booking.companyId,
    customerUserId: booking.customerUserId || '', requesterId: cleanText(requesterId), currentScheduleId: booking.scheduleId || '',
    requestedScheduleId: cleanText(requestedScheduleId || ''), preferredDate: preferredDate ? new Date(preferredDate).toISOString() : null,
    preferredTime: cleanText(preferredTime || ''), reason: cleanText(reason || 'Customer requested reschedule'), status: 'pending',
    createdAt: now, updatedAt: now,
  };
  const ticket = {
    id: await nextId('support'), ownerType: 'customer', ownerId: requesterId, userId: requesterId,
    companyId: booking.companyId, bookingId: booking.id, bookingRef: booking.bookingRef, category: 'Booking issue',
    subject: `Reschedule request ${booking.bookingRef}`, message: request.reason, priority: 'medium', status: 'open',
    assignedTo: 'support', createdBy: requesterId,
    metadata: { rescheduleRequestId: request.id, preferredDate: request.preferredDate, preferredTime: request.preferredTime, requestedScheduleId: request.requestedScheduleId },
    createdAt: now,
  };
  await supportRepository.rescheduleRequests.save(request, { id: request.id });
  await supportRepository.tickets.save(ticket, { id: ticket.id });
  await recordEvent({ bookingRef: booking.bookingRef, companyId: booking.companyId, entityType: 'reschedule_request', entityId: request.id, action: 'reschedule.requested', title: `Reschedule requested for ${booking.bookingRef}`, message: request.reason, status: 'pending', actorType: 'customer', actorId: requesterId, metadata: { preferredDate: request.preferredDate, preferredTime: request.preferredTime, supportTicketId: ticket.id } });
  await audit(requesterId, 'reschedule.requested', request.id, { bookingRef: booking.bookingRef });
  return request;
}

async function reviewReschedule(requestId, { status = 'approved', actorId = 'admin-system', approvedScheduleId = '', reviewNote = '' } = {}) {
  const request = await supportRepository.rescheduleRequests.findOne({ $or: [{ id: requestId }, { bookingRef: requestId }] });
  if (!request) { const error = new Error('Reschedule request not found'); error.status = 404; throw error; }
  if (request.status !== 'pending') return request;
  const booking = await supportRepository.bookings.findOne({ bookingRef: request.bookingRef });
  const normalized = normalize(status) === 'approved' ? 'approved' : 'rejected';
  const now = new Date().toISOString();
  Object.assign(request, {
    status: normalized, reviewedBy: actorId, reviewedAt: now,
    reviewNote: cleanText(reviewNote || (normalized === 'approved' ? 'Reschedule approved' : 'Reschedule rejected')),
    approvedScheduleId: normalized === 'approved' ? cleanText(approvedScheduleId || request.requestedScheduleId || request.currentScheduleId || '') : '',
    updatedAt: now,
  });
  if (normalized === 'approved' && booking) {
    const previousScheduleId = booking.scheduleId;
    if (request.approvedScheduleId) booking.scheduleId = request.approvedScheduleId;
    Object.assign(booking, { bookingStatus: 'rescheduled', rescheduledAt: now, previousScheduleId });
    request.appliedAt = now;
  }
  const ticket = await supportRepository.tickets.findOne({ $or: [{ 'metadata.rescheduleRequestId': request.id }, { subject: `Reschedule request ${request.bookingRef}` }] });
  if (ticket) {
    Object.assign(ticket, { status: normalized === 'approved' ? 'resolved' : 'closed', resolutionNotes: request.reviewNote, resolvedBy: actorId, resolvedAt: now, updatedAt: now });
    await supportRepository.tickets.save(ticket, { id: ticket.id });
  }
  await supportRepository.rescheduleRequests.save(request, { id: request.id });
  if (booking) await supportRepository.bookings.save(booking, { bookingRef: booking.bookingRef });
  await recordEvent({ bookingRef: request.bookingRef, companyId: request.companyId, entityType: 'reschedule_request', entityId: request.id, action: normalized === 'approved' ? 'reschedule.approved' : 'reschedule.rejected', title: normalized === 'approved' ? `Reschedule approved for ${request.bookingRef}` : `Reschedule rejected for ${request.bookingRef}`, message: request.reviewNote, status: normalized, actorType: 'admin', actorId, metadata: { approvedScheduleId: request.approvedScheduleId, supportTicketId: ticket?.id || '' } });
  await audit(actorId, `reschedule.${normalized}`, request.id, { bookingRef: request.bookingRef });
  return request;
}

module.exports = { recordEvent, bookingTimeline, ticketTimeline, attachSupportEvent, replySupportTicket, requestReschedule, reviewReschedule };

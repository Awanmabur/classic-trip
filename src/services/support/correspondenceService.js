const supportRepository = require('../../repositories/domain/supportRepository');
const notificationService = require('../notification/notificationService');
const timelineService = require('./timelineService');
const { nextId } = require('../data/idService');

function cleanText(value) { return String(value || '').replace(/<[^>]*>/g, '').trim(); }
function normalize(value) { return cleanText(value).toLowerCase().replace(/\s+/g, '_'); }

async function findLinked(payload = {}) {
  const bookingRef = cleanText(payload.bookingRef || '').replace(/^#/, '');
  const booking = bookingRef ? await supportRepository.bookings.findOne({ bookingRef }) : null;
  const supportTicket = payload.supportTicketId ? await supportRepository.tickets.findOne({ id: payload.supportTicketId }) : null;
  const refund = payload.refundId ? await supportRepository.refunds.findOne({ id: payload.refundId }) : null;
  const agreement = payload.agreementId ? await supportRepository.agreements.findOne({ id: payload.agreementId }) : null;
  const verification = payload.verificationId ? await supportRepository.verificationReviews.findOne({ $or: [{ id: payload.verificationId }, { targetId: payload.verificationId }] }) : null;
  const driver = payload.driverId ? await supportRepository.companyEmployees.findOne({ $or: [{ id: payload.driverId }, { userId: payload.driverId }] }) : null;
  const companyId = payload.companyId || booking?.companyId || supportTicket?.companyId || refund?.companyId || agreement?.companyId || verification?.companyId || driver?.companyId || '';
  const customerUserId = payload.customerUserId || booking?.customerUserId || supportTicket?.ownerId || refund?.customerUserId || '';
  return { booking, supportTicket, refund, agreement, verification, driver, companyId, customerUserId };
}

async function messageRows(filters = {}, { includeInternal = false } = {}) {
  return (await supportRepository.messages.list({}))
    .filter((message) => includeInternal || message.visibility !== 'internal')
    .filter((message) => {
      if (filters.companyId && message.companyId !== filters.companyId) return false;
      if (filters.customerUserId && ![message.customerUserId, message.ownerId, message.customerId].includes(filters.customerUserId)) return false;
      for (const key of ['bookingRef', 'supportTicketId', 'refundId', 'agreementId', 'verificationId', 'driverId']) if (filters[key] && message[key] !== filters[key]) return false;
      return true;
    })
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

async function logDeliveryAttempts({ notifications = [], message, requestedChannels = [], recipient = {} } = {}) {
  const rows = [];
  const channels = Array.from(new Set([...(requestedChannels || []), ...notifications.map((note) => note.channel)].filter(Boolean)));
  const byChannel = new Map(notifications.map((note) => [note.channel, note]));
  for (const channel of channels) {
    const note = byChannel.get(channel);
    const now = new Date().toISOString();
    const attempt = {
      id: await nextId('delivery'), notificationId: note?.id || '', correspondenceMessageId: message?.id || '',
      referenceType: message?.supportTicketId ? 'support_ticket' : (message?.bookingRef ? 'booking' : 'correspondence_message'),
      referenceId: message?.supportTicketId || message?.bookingRef || message?.id || '', bookingRef: message?.bookingRef || '',
      userId: message?.customerUserId || message?.ownerId || '', channel, recipient,
      provider: note?.deliveryProvider || (channel === 'in_app' ? 'classic_trip_in_app' : channel),
      status: note?.deliveryStatus || note?.status || (channel === 'in_app' ? 'delivered' : 'queued'),
      response: note?.deliveryResponse || '', attemptedAt: now, completedAt: now,
      metadata: { title: message?.subject || '', visibility: message?.visibility || 'shared' }, createdAt: now, updatedAt: now,
    };
    await supportRepository.deliveryAttempts.save(attempt, { id: attempt.id });
    rows.push(attempt);
  }
  return rows;
}

async function recipientFor(payload = {}, linked = {}) {
  const booking = linked.booking || {};
  const user = payload.customerUserId ? await supportRepository.users.findOne({ id: payload.customerUserId }) : null;
  return {
    email: payload.email || user?.email || booking.guestSnapshot?.email || '',
    phone: payload.phone || user?.phone || booking.guestSnapshot?.phone || '',
    whatsapp: payload.whatsapp || user?.whatsapp || user?.phone || booking.guestSnapshot?.phone || '',
    name: payload.name || user?.fullName || booking.guestSnapshot?.fullName || '',
  };
}

async function createMessage(payload = {}) {
  const linked = await findLinked(payload);
  const text = cleanText(payload.message || payload.body || '');
  if (!text) { const error = new Error('Correspondence message is required'); error.status = 422; throw error; }
  const visibility = normalize(payload.visibility || 'shared');
  const channels = Array.from(new Set([...(Array.isArray(payload.channels) ? payload.channels : String(payload.channels || '').split(',')), ...(visibility === 'internal' ? [] : ['in_app'])].map(normalize).filter(Boolean)));
  const id = await nextId('corr');
  const now = new Date().toISOString();
  const message = {
    id, threadId: cleanText(payload.threadId || payload.supportTicketId || payload.bookingRef || id),
    ownerType: cleanText(payload.ownerType || linked.supportTicket?.ownerType || payload.actorType || 'support'),
    ownerId: cleanText(payload.ownerId || linked.supportTicket?.ownerId || payload.actorId || ''),
    companyId: cleanText(linked.companyId || ''), customerUserId: cleanText(linked.customerUserId || ''),
    bookingId: cleanText(payload.bookingId || linked.booking?.id || linked.supportTicket?.bookingId || ''),
    bookingRef: cleanText(payload.bookingRef || linked.booking?.bookingRef || linked.supportTicket?.bookingRef || linked.refund?.bookingRef || ''),
    ticketId: cleanText(payload.ticketId || payload.ticketLegId || ''), refundId: cleanText(payload.refundId || linked.refund?.id || ''),
    supportTicketId: cleanText(payload.supportTicketId || linked.supportTicket?.id || ''), agreementId: cleanText(payload.agreementId || linked.agreement?.id || ''),
    verificationId: cleanText(payload.verificationId || linked.verification?.id || ''), driverId: cleanText(payload.driverId || linked.driver?.id || ''),
    customerId: cleanText(payload.customerId || linked.customerUserId || ''), payoutRequestId: cleanText(payload.payoutRequestId || ''),
    subject: cleanText(payload.subject || linked.supportTicket?.subject || 'Correspondence message'), message: text,
    category: cleanText(payload.category || linked.supportTicket?.category || 'support'), direction: normalize(payload.direction || 'outbound'),
    visibility, actorType: normalize(payload.actorType || 'support'), actorId: cleanText(payload.actorId || 'support-system'),
    actorName: cleanText(payload.actorName || payload.actorId || 'Classic Trip'), status: normalize(payload.status || linked.supportTicket?.status || 'open'),
    channels, deliveryAttemptIds: [], tags: Array.isArray(payload.tags) ? payload.tags.map(cleanText).filter(Boolean) : [],
    metadata: payload.metadata || {}, createdAt: now, updatedAt: now,
  };
  await supportRepository.messages.save(message, { id: message.id });
  let notifications = [];
  if (visibility !== 'internal' && channels.length) {
    const deliveryChannels = channels.filter((channel) => ['email', 'sms', 'whatsapp'].includes(channel));
    if (deliveryChannels.length) notifications = await notificationService.queueNotification({ userId: message.customerUserId || message.ownerId || null, channels: deliveryChannels, title: message.subject, message: text, recipient: await recipientFor(payload, linked), referenceType: message.supportTicketId ? 'support_ticket' : 'correspondence_message', referenceId: message.supportTicketId || message.id, meta: { bookingRef: message.bookingRef, correspondenceMessageId: message.id, visibility } }).catch(() => []);
  }
  const attempts = await logDeliveryAttempts({ notifications, message, requestedChannels: channels, recipient: await recipientFor(payload, linked) });
  message.deliveryAttemptIds = attempts.map((attempt) => attempt.id);
  await supportRepository.messages.save(message, { id: message.id });
  await timelineService.recordEvent({ bookingRef: message.bookingRef, companyId: message.companyId, customerUserId: message.customerUserId, entityType: 'correspondence_message', entityId: message.id, action: visibility === 'internal' ? 'correspondence.internal_note.added' : 'correspondence.message.sent', title: message.subject, message: text, status: message.status, visibility, actorType: message.actorType, actorId: message.actorId, actorName: message.actorName, metadata: { supportTicketId: message.supportTicketId, channels, deliveryAttemptIds: message.deliveryAttemptIds } });
  const audit = { id: await nextId('audit'), actorId: message.actorId, action: visibility === 'internal' ? 'correspondence.internal_note.added' : 'correspondence.message.sent', target: message.id, meta: { bookingRef: message.bookingRef, supportTicketId: message.supportTicketId, visibility }, createdAt: now };
  await supportRepository.auditLogs.save(audit, { id: audit.id });
  return message;
}

async function createInternalNote(payload = {}) { return createMessage({ ...payload, visibility: 'internal', channels: [] }); }
async function linkToSupportTicket(ticket, payload = {}) {
  if (!ticket) return null;
  return createMessage({ ...payload, supportTicketId: ticket.id, bookingRef: ticket.bookingRef, companyId: ticket.companyId, customerUserId: ticket.ownerId, subject: payload.subject || ticket.subject, category: payload.category || ticket.category, status: payload.status || ticket.status });
}

module.exports = { createMessage, createInternalNote, linkToSupportTicket, messageRows, logDeliveryAttempts };

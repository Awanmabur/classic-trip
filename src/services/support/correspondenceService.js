const store = require('../data/persistentStore');
const notificationService = require('../notification/notificationService');
const timelineService = require('./timelineService');
const { mongoose } = require('../../config/db');

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

function normalize(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, '_');
}

function ensureCollections() {
  if (!Array.isArray(store.state.correspondenceMessages)) store.state.correspondenceMessages = [];
  if (!Array.isArray(store.state.notificationDeliveryAttempts)) store.state.notificationDeliveryAttempts = [];
  if (!Array.isArray(store.state.bookingTimelineEvents)) store.state.bookingTimelineEvents = [];
  if (!Array.isArray(store.state.supportTickets)) store.state.supportTickets = [];
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

function findLinked(payload = {}) {
  ensureCollections();
  if (!Array.isArray(store.state.refundRequests)) store.state.refundRequests = [];
  if (!Array.isArray(store.state.agreements)) store.state.agreements = [];
  if (!Array.isArray(store.state.verificationReviews)) store.state.verificationReviews = [];
  if (!Array.isArray(store.state.companyEmployees)) store.state.companyEmployees = [];
  const bookingRef = cleanText(payload.bookingRef || '').replace(/^#/, '');
  const booking = bookingRef ? store.findBooking(bookingRef) : null;
  const supportTicket = payload.supportTicketId
    ? store.state.supportTickets.find((ticket) => ticket.id === payload.supportTicketId)
    : null;
  const refund = payload.refundId ? store.state.refundRequests.find((row) => row.id === payload.refundId) : null;
  const agreement = payload.agreementId ? store.state.agreements.find((row) => row.id === payload.agreementId) : null;
  const verification = payload.verificationId ? store.state.verificationReviews.find((row) => row.id === payload.verificationId || row.targetId === payload.verificationId) : null;
  const driver = payload.driverId ? store.state.companyEmployees.find((row) => row.id === payload.driverId || row.userId === payload.driverId) : null;
  const companyId = payload.companyId || booking?.companyId || supportTicket?.companyId || refund?.companyId || agreement?.companyId || verification?.companyId || driver?.companyId || '';
  const customerUserId = payload.customerUserId || booking?.customerUserId || supportTicket?.ownerId || refund?.customerUserId || '';
  return { booking, supportTicket, refund, agreement, verification, driver, companyId, customerUserId };
}

function messageRows(filters = {}, { includeInternal = false } = {}) {
  ensureCollections();
  return store.state.correspondenceMessages
    .filter((message) => includeInternal || message.visibility !== 'internal')
    .filter((message) => {
      if (filters.companyId && message.companyId !== filters.companyId) return false;
      if (filters.customerUserId && message.customerUserId !== filters.customerUserId && message.ownerId !== filters.customerUserId && message.customerId !== filters.customerUserId) return false;
      if (filters.bookingRef && message.bookingRef !== filters.bookingRef) return false;
      if (filters.supportTicketId && message.supportTicketId !== filters.supportTicketId) return false;
      if (filters.refundId && message.refundId !== filters.refundId) return false;
      if (filters.agreementId && message.agreementId !== filters.agreementId) return false;
      if (filters.verificationId && message.verificationId !== filters.verificationId) return false;
      if (filters.driverId && message.driverId !== filters.driverId) return false;
      return true;
    })
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

async function logDeliveryAttempts({ notifications = [], message, requestedChannels = [], recipient = {} } = {}) {
  ensureCollections();
  const rows = [];
  const channels = Array.from(new Set([...(requestedChannels || []), ...notifications.map((note) => note.channel)].filter(Boolean)));
  const byChannel = new Map(notifications.map((note) => [note.channel, note]));
  for (const channel of channels) {
    const note = byChannel.get(channel);
    const attempt = {
      id: nextId('delivery', store.state.notificationDeliveryAttempts),
      notificationId: note?.id || '',
      correspondenceMessageId: message?.id || '',
      referenceType: message?.supportTicketId ? 'support_ticket' : (message?.bookingRef ? 'booking' : 'correspondence_message'),
      referenceId: message?.supportTicketId || message?.bookingRef || message?.id || '',
      bookingRef: message?.bookingRef || '',
      userId: message?.customerUserId || message?.ownerId || '',
      channel,
      recipient,
      provider: note?.deliveryProvider || (channel === 'in_app' ? 'classic_trip_in_app' : channel),
      status: note?.deliveryStatus || note?.status || (channel === 'in_app' ? 'delivered' : 'queued'),
      response: note?.deliveryResponse || '',
      attemptedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      metadata: { title: message?.subject || '', visibility: message?.visibility || 'shared' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.state.notificationDeliveryAttempts.unshift(attempt);
    rows.push(attempt);
    await persist('NotificationDeliveryAttempt', attempt);
  }
  return rows;
}

function recipientFor(payload = {}, linked = {}) {
  const booking = linked.booking || {};
  const user = payload.customerUserId ? store.state.users.find((row) => row.id === payload.customerUserId) : null;
  return {
    email: payload.email || user?.email || booking.guestSnapshot?.email || '',
    phone: payload.phone || user?.phone || booking.guestSnapshot?.phone || '',
    whatsapp: payload.whatsapp || user?.whatsapp || user?.phone || booking.guestSnapshot?.phone || '',
    name: payload.name || user?.fullName || booking.guestSnapshot?.fullName || '',
  };
}

async function createMessage(payload = {}) {
  ensureCollections();
  const linked = findLinked(payload);
  const text = cleanText(payload.message || payload.body || '');
  if (!text) {
    const error = new Error('Correspondence message is required');
    error.status = 422;
    throw error;
  }
  const visibility = normalize(payload.visibility || 'shared');
  const channels = Array.from(new Set([...(Array.isArray(payload.channels) ? payload.channels : String(payload.channels || '').split(',')), ...(visibility === 'internal' ? [] : ['in_app'])].map((item) => normalize(item)).filter(Boolean)));
  const id = nextId('corr', store.state.correspondenceMessages);
  const now = new Date().toISOString();
  const message = {
    id,
    threadId: cleanText(payload.threadId || payload.supportTicketId || payload.bookingRef || id),
    ownerType: cleanText(payload.ownerType || linked.supportTicket?.ownerType || payload.actorType || 'support'),
    ownerId: cleanText(payload.ownerId || linked.supportTicket?.ownerId || payload.actorId || ''),
    companyId: cleanText(linked.companyId || ''),
    customerUserId: cleanText(linked.customerUserId || ''),
    bookingId: cleanText(payload.bookingId || linked.booking?.id || linked.supportTicket?.bookingId || ''),
    bookingRef: cleanText(payload.bookingRef || linked.booking?.bookingRef || linked.supportTicket?.bookingRef || linked.refund?.bookingRef || ''),
    ticketId: cleanText(payload.ticketId || payload.ticketLegId || ''),
    refundId: cleanText(payload.refundId || linked.refund?.id || ''),
    supportTicketId: cleanText(payload.supportTicketId || linked.supportTicket?.id || ''),
    agreementId: cleanText(payload.agreementId || linked.agreement?.id || ''),
    verificationId: cleanText(payload.verificationId || linked.verification?.id || ''),
    driverId: cleanText(payload.driverId || linked.driver?.id || ''),
    customerId: cleanText(payload.customerId || linked.customerUserId || ''),
    payoutRequestId: cleanText(payload.payoutRequestId || ''),
    subject: cleanText(payload.subject || linked.supportTicket?.subject || 'Correspondence message'),
    message: text,
    category: cleanText(payload.category || linked.supportTicket?.category || 'support'),
    direction: normalize(payload.direction || 'outbound'),
    visibility,
    actorType: normalize(payload.actorType || 'support'),
    actorId: cleanText(payload.actorId || 'support-system'),
    actorName: cleanText(payload.actorName || payload.actorId || 'Classic Trip'),
    status: normalize(payload.status || linked.supportTicket?.status || 'open'),
    channels,
    deliveryAttemptIds: [],
    tags: Array.isArray(payload.tags) ? payload.tags.map(cleanText).filter(Boolean) : [],
    metadata: payload.metadata || {},
    createdAt: now,
    updatedAt: now,
  };
  store.state.correspondenceMessages.unshift(message);
  await persist('CorrespondenceMessage', message);

  let notifications = [];
  if (visibility !== 'internal' && channels.length) {
    const deliveryChannels = channels.filter((channel) => ['email', 'sms', 'whatsapp'].includes(channel));
    if (deliveryChannels.length) {
      notifications = await notificationService.queueNotification({
        userId: message.customerUserId || message.ownerId || null,
        channels: deliveryChannels,
        title: message.subject,
        message: text,
        recipient: recipientFor(payload, linked),
        referenceType: message.supportTicketId ? 'support_ticket' : 'correspondence_message',
        referenceId: message.supportTicketId || message.id,
        meta: { bookingRef: message.bookingRef, correspondenceMessageId: message.id, visibility },
      }).catch(() => []);
    }
  }
  const attempts = await logDeliveryAttempts({ notifications, message, requestedChannels: channels, recipient: recipientFor(payload, linked) });
  message.deliveryAttemptIds = attempts.map((attempt) => attempt.id);
  await persist('CorrespondenceMessage', message);

  await timelineService.recordEvent({
    bookingRef: message.bookingRef,
    companyId: message.companyId,
    customerUserId: message.customerUserId,
    entityType: 'correspondence_message',
    entityId: message.id,
    action: visibility === 'internal' ? 'correspondence.internal_note.added' : 'correspondence.message.sent',
    title: message.subject,
    message: text,
    status: message.status,
    visibility,
    actorType: message.actorType,
    actorId: message.actorId,
    actorName: message.actorName,
    metadata: { supportTicketId: message.supportTicketId, channels, deliveryAttemptIds: message.deliveryAttemptIds },
  });
  store.state.auditLogs.unshift({ id: nextId('audit', store.state.auditLogs), actorId: message.actorId, action: visibility === 'internal' ? 'correspondence.internal_note.added' : 'correspondence.message.sent', target: message.id, meta: { bookingRef: message.bookingRef, supportTicketId: message.supportTicketId, visibility }, createdAt: now });
  return message;
}

async function createInternalNote(payload = {}) {
  return createMessage({ ...payload, visibility: 'internal', channels: [] });
}

async function linkToSupportTicket(ticket, payload = {}) {
  if (!ticket) return null;
  return createMessage({
    ...payload,
    supportTicketId: ticket.id,
    bookingRef: ticket.bookingRef,
    companyId: ticket.companyId,
    customerUserId: ticket.ownerId,
    subject: payload.subject || ticket.subject,
    category: payload.category || ticket.category,
    status: payload.status || ticket.status,
  });
}

module.exports = {
  createMessage,
  createInternalNote,
  linkToSupportTicket,
  messageRows,
  logDeliveryAttempts,
};

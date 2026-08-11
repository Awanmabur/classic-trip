const crypto = require('crypto');
const notificationRepository = require('../../repositories/domain/notificationRepository');
const { env } = require('../../config/env');
const ticketAccessService = require('../booking/ticketAccessService');
const { sendEmail } = require('./emailService');
const { sendSms } = require('./smsService');
const { sendWhatsapp } = require('./whatsappService');
const pushService = require('./pushService');
const outboxService = require('../shared/outboxService');
const sensitiveFieldService = require('../security/sensitiveFieldService');

async function persistNotifications(rows, attempts = []) {
  await notificationRepository.notifications.saveMany(rows, (row) => ({ id: row.id }));
  await notificationRepository.deliveryAttempts.saveMany(attempts, (row) => ({ id: row.id }));
}

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

function nextNotificationId() {
  return `notification-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function notificationIdForDedupe(dedupeKey) {
  return `notification-${crypto.createHash('sha256').update(dedupeKey).digest('hex').slice(0, 24)}`;
}

async function claimNotificationDelivery(row, owner) {
  if (!row.dedupeKey) return row;
  await notificationRepository.notifications.updateOne(
    { dedupeKey: row.dedupeKey },
    { $setOnInsert: row },
    { upsert: true },
  );
  const timestamp = new Date();
  const claimed = await notificationRepository.notifications.repository.findOneAndUpdate({
    dedupeKey: row.dedupeKey,
    deliveryStatus: { $nin: ['sent', 'delivered'] },
    $or: [
      { dispatchLeaseUntil: { $exists: false } },
      { dispatchLeaseUntil: null },
      { dispatchLeaseUntil: { $lte: timestamp } },
      { dispatchOwner: owner },
    ],
  }, {
    $set: {
      dispatchOwner: owner,
      dispatchLeaseUntil: new Date(timestamp.getTime() + 5 * 60 * 1000),
    },
    $inc: { dispatchAttempts: 1 },
  }, { new: true });
  if (claimed) return claimed;
  return notificationRepository.notifications.findOne({ dedupeKey: row.dedupeKey });
}

async function enqueueNotification(payload = {}, options = {}) {
  const aggregateId = String(options.aggregateId || payload.referenceId || payload.userId || nextNotificationId());
  const event = outboxService.createEvent({
    topic: 'notification.secure_requested',
    aggregateType: String(options.aggregateType || payload.referenceType || 'notification'),
    aggregateId,
    companyId: String(options.companyId || payload.meta?.companyId || ''),
    dedupeKey: String(options.dedupeKey || `notification:${payload.referenceType || 'general'}:${aggregateId}:${Date.now()}`),
    payload: {
      encrypted: sensitiveFieldService.encrypt(JSON.stringify(payload), 'outbox-notification'),
    },
  });
  await outboxService.enqueue(event);
  return event;
}

async function queueNotification({
  userId = null,
  channels = ['email'],
  title,
  message,
  recipient = {},
  referenceType = '',
  referenceId = '',
  meta = {},
  persistedMessage = null,
  persistedMeta = null,
  ownerType = meta.ownerType || '',
  ownerId = meta.ownerId || userId || '',
  audience = meta.audience || '',
  dedupeKey = '',
  channelMessages = {},
} = {}) {
  const cleanTitle = cleanText(title || 'Classic Trip update');
  const deliveryMessage = cleanText(message || '');
  const storedMessage = persistedMessage === null ? deliveryMessage : cleanText(persistedMessage || '');
  const storedMeta = persistedMeta === null ? meta : persistedMeta;
  const rows = [];
  const deliveryTasks = [];
  const attempts = [];
  const uniqueChannels = Array.from(new Set(Array.isArray(channels) ? channels : [channels])).filter(Boolean);
  const deliveryOwner = `notification-worker-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const dedupeBase = String(dedupeKey || '').trim().slice(0, 420);

  for (const channel of uniqueChannels) {
    const channelMessage = cleanText(channelMessages?.[channel] || deliveryMessage);
    const channelDedupeKey = dedupeBase ? `${dedupeBase}:${channel}`.slice(0, 500) : '';
    const row = {
      id: channelDedupeKey ? notificationIdForDedupe(channelDedupeKey) : nextNotificationId(),
      userId,
      channel,
      title: cleanTitle,
      message: storedMessage,
      recipient,
      ownerType,
      ownerId,
      audience,
      referenceType,
      referenceId,
      ...(channelDedupeKey ? { dedupeKey: channelDedupeKey } : {}),
      meta: storedMeta,
      status: 'queued',
      deliveryStatus: 'queued',
      sentCount: 0,
      deliveredCount: 0,
      failedCount: 0,
      createdAt: new Date().toISOString(),
    };
    // A durable per-channel claim makes outbox retries safe. An expired lease
    // can be reclaimed after a worker crash, while sent deliveries are returned
    // without contacting the provider again.
    // eslint-disable-next-line no-await-in-loop
    const claimed = await claimNotificationDelivery(row, deliveryOwner);
    if (!claimed || (channelDedupeKey && claimed.dispatchOwner !== deliveryOwner)) {
      if (claimed) rows.push(claimed);
      continue;
    }
    rows.push(claimed);

    const attempt = {
      id: `notification-attempt-${claimed.id}-${claimed.dispatchAttempts || 1}`,
      notificationId: claimed.id,
      referenceType,
      referenceId,
      bookingRef: meta.bookingRef || '',
      userId: userId || '',
      channel,
      recipient,
      provider: channel,
      status: 'queued',
      attemptedAt: new Date().toISOString(),
      metadata: storedMeta,
    };
    attempts.push(attempt);
    if (channel === 'in_app') deliveryTasks.push({ row: claimed, attempt, promise: Promise.resolve({ status: 'sent', channel: 'in_app', provider: 'notification-center', response: 'Stored in notification center' }) });
    if (channel === 'push') deliveryTasks.push({ row: claimed, attempt, promise: pushService.sendPush({ userId, audience, title: cleanTitle, message: channelMessage, recipient, referenceType, referenceId, meta }) });
    if (channel === 'email') deliveryTasks.push({ row: claimed, attempt, promise: sendEmail({ to: recipient.email, title: cleanTitle, message: channelMessage, meta }) });
    if (channel === 'sms') deliveryTasks.push({ row: claimed, attempt, promise: sendSms({ to: recipient.phone, title: cleanTitle, message: channelMessage, meta }) });
    if (channel === 'whatsapp') deliveryTasks.push({ row: claimed, attempt, promise: sendWhatsapp({ to: recipient.whatsapp || recipient.phone, title: cleanTitle, message: channelMessage, meta }) });
  }

  const deliveries = await Promise.allSettled(deliveryTasks.map((item) => item.promise));
  deliveries.forEach((delivery, index) => {
    const row = deliveryTasks[index].row;
    const result = delivery.status === 'fulfilled'
      ? delivery.value
      : { status: 'failed', reason: delivery.reason?.message || 'Delivery failed' };
    row.status = result.status || 'queued';
    row.deliveryStatus = row.status;
    row.deliveryProvider = result.provider || row.channel;
    row.deliveryResponse = result.response || result.reason || result.providerReference || '';
    row.sentCount = Number(result.sentCount ?? (row.status === 'sent' ? 1 : 0));
    row.deliveredCount = Number(result.deliveredCount ?? result.sentCount ?? (row.status === 'sent' ? 1 : 0));
    row.failedCount = Number(result.failedCount ?? (row.status === 'failed' ? 1 : 0));
    if (row.status === 'sent') row.sentAt = new Date().toISOString();
    row.dispatchOwner = '';
    row.dispatchLeaseUntil = null;
    const attempt = deliveryTasks[index].attempt;
    attempt.status = row.deliveryStatus;
    attempt.provider = row.deliveryProvider;
    attempt.response = row.deliveryResponse;
    attempt.error = row.status === 'failed' ? row.deliveryResponse : '';
    attempt.completedAt = new Date().toISOString();
  });
  await persistNotifications(rows, attempts);
  return rows;
}

function bookingRecipient(booking = {}) {
  return {
    email: booking.guestSnapshot?.email,
    phone: booking.guestSnapshot?.phone,
    whatsapp: booking.guestSnapshot?.phone,
    name: booking.guestSnapshot?.fullName,
  };
}

function bookingAddons(booking = {}) {
  const rows = Array.isArray(booking.addons)
    ? booking.addons
    : (Array.isArray(booking.pricing?.addons) ? booking.pricing.addons : []);
  return rows.filter(Boolean);
}

function hasCommunicationTicketAddon(booking = {}) {
  return bookingAddons(booking).some((addon) => {
    const category = String(addon.category || '').trim().toLowerCase();
    const identity = `${addon.id || ''} ${addon.name || ''}`.toLowerCase();
    return category === 'communication' || /sms|whatsapp|ticket copy/.test(identity);
  });
}

function bookingConfirmationChannels(booking = {}) {
  // A paid ticket must reach the traveller without requiring an account or an
  // optional communication add-on. SMS is included whenever a phone exists.
  const channels = ['in_app', 'push'];
  const recipient = bookingRecipient(booking);
  if (recipient.email) channels.push('email');
  if (recipient.phone) channels.push('sms', 'whatsapp');
  return channels;
}

function bookingConfirmationRequest(booking = {}) {
  const ticketPath = ticketAccessService.ticketUrl(booking);
  const ticketPdfPath = ticketAccessService.ticketUrl(booking, '.pdf');
  const isHotel = String(booking.serviceType || '').toLowerCase() === 'hotel';
  const artifactName = isHotel ? 'Voucher' : 'Ticket';
  const webTicketUrl = `${env.appUrl}${ticketPath}`;
  const pdfTicketUrl = `${env.appUrl}${ticketPdfPath}`;
  return {
    userId: booking.customerUserId || null,
    channels: bookingConfirmationChannels(booking),
    title: `${isHotel ? 'Hotel booking' : 'Booking'} confirmed ${booking.bookingRef}`,
    message: `Your Classic Trip ${isHotel ? 'hotel booking' : 'booking'} ${booking.bookingRef} is confirmed. ${artifactName}: ${webTicketUrl} PDF: ${pdfTicketUrl}`,
    channelMessages: {
      sms: `Classic Trip ${artifactName.toLowerCase()} ${booking.bookingRef} confirmed. Open: ${webTicketUrl}`,
    },
    recipient: bookingRecipient(booking),
    ownerType: booking.customerUserId ? 'customer' : 'guest',
    ownerId: booking.customerUserId || booking.guestSnapshot?.email || booking.guestSnapshot?.phone || '',
    audience: 'customers',
    referenceType: 'booking',
    referenceId: booking.id,
    dedupeKey: `booking-confirmed:${booking.id}`,
    meta: { bookingRef: booking.bookingRef, companyId: booking.companyId, ticketUrl: ticketPath, ticketPdfUrl: ticketPdfPath, url: ticketPath, alertScope: 'traveller' },
  };
}

function bookingOperationalRequests(booking = {}) {
  const companyId = String(booking.providerCompanyId || booking.agentCompanyId || booking.companyId || '').trim();
  const serviceLabel = String(booking.serviceType || 'booking').replace(/[_-]+/g, ' ');
  const amount = Number(booking.pricing?.total || 0);
  const currency = String(booking.pricing?.currency || '').trim().toUpperCase();
  const totalLabel = amount > 0 ? ` ${currency ? `${currency} ` : ''}${amount.toLocaleString('en-US')}` : '';
  const commonMeta = {
    bookingRef: booking.bookingRef,
    bookingId: booking.id,
    companyId,
    eventType: 'booking_confirmed',
    alertSound: 'booking',
    priority: 'high',
  };
  const requests = [];
  if (companyId) {
    requests.push({
      userId: null,
      channels: ['in_app', 'push'],
      title: `New booking ${booking.bookingRef}`,
      message: `A customer completed a ${serviceLabel} booking${totalLabel}. Open Bookings to review the reservation and fulfilment details.`,
      recipient: {},
      ownerType: 'company',
      ownerId: companyId,
      audience: 'partners',
      referenceType: 'booking',
      referenceId: booking.id,
      dedupeKey: `booking-operational-company:${booking.id}:${companyId}`,
      meta: { ...commonMeta, url: '/company/bookings', alertScope: 'partner_booking' },
    });
  }
  requests.push({
    userId: null,
    channels: ['in_app', 'push'],
    title: `Booking completed ${booking.bookingRef}`,
    message: `A customer completed a ${serviceLabel} booking${totalLabel}. Open platform Bookings for oversight and support.`,
    recipient: {},
    ownerType: 'platform',
    ownerId: 'super-admin',
    audience: 'admins',
    referenceType: 'booking',
    referenceId: booking.id,
    dedupeKey: `booking-operational-admin:${booking.id}`,
    meta: { ...commonMeta, url: '/admin/bookings', alertScope: 'admin_booking' },
  });
  return requests;
}

async function bookingConfirmed(booking) {
  const requests = [bookingConfirmationRequest(booking), ...bookingOperationalRequests(booking)];
  const groups = [];
  for (const request of requests) {
    // eslint-disable-next-line no-await-in-loop
    groups.push(await queueNotification(request));
  }
  return groups.flat();
}

async function enqueueBookingConfirmed(booking) {
  const requests = [bookingConfirmationRequest(booking), ...bookingOperationalRequests(booking)];
  const events = [];
  for (const request of requests) {
    // eslint-disable-next-line no-await-in-loop
    events.push(await enqueueNotification(request, {
      aggregateType: 'booking',
      aggregateId: booking.id,
      companyId: booking.companyId,
      dedupeKey: `booking-confirmed-delivery:${booking.id}:${request.meta?.alertScope || request.audience || 'customer'}`,
    }));
  }
  return events;
}

async function paymentUpdated(booking, payment) {
  return queueNotification({
    userId: booking.customerUserId || null,
    channels: ['in_app', 'push', 'email'],
    title: `Payment ${payment.status}`,
    message: `Payment for booking ${booking.bookingRef} is ${payment.status}.`,
    recipient: bookingRecipient(booking),
    referenceType: 'payment',
    referenceId: payment.id,
    dedupeKey: `payment-updated:${payment.id}:${payment.status}`,
    meta: { bookingRef: booking.bookingRef, providerReference: payment.providerReference },
  });
}

async function refundApproved(booking, refund) {
  return queueNotification({
    userId: booking.customerUserId || refund.requesterId || null,
    channels: ['in_app', 'push', 'email', 'whatsapp'],
    title: `Refund approved ${booking.bookingRef}`,
    message: `Your refund for booking ${booking.bookingRef} has been approved.`,
    recipient: bookingRecipient(booking),
    referenceType: 'refund',
    referenceId: refund.id,
    dedupeKey: `refund-approved:${refund.id}`,
    meta: { bookingRef: booking.bookingRef, amount: refund.amount },
  });
}

async function employeeInvited(user, employee) {
  return queueNotification({
    userId: user.id,
    channels: ['in_app', 'push', 'email'],
    title: 'Classic Trip staff invite',
    message: `You have been invited as ${employee.roleTitle}.`,
    recipient: { email: user.email, phone: user.phone, name: user.fullName },
    referenceType: 'company_employee',
    referenceId: employee.id,
    dedupeKey: `employee-invited:${employee.id}`,
    meta: { companyId: employee.companyId, permissions: employee.permissions },
  });
}

function channelLabel(note = {}) {
  return Array.isArray(note.channels) ? note.channels.join(', ') : note.channel || 'email';
}

function recipientLabel(note = {}) {
  return note.recipient?.name || note.recipient?.email || note.recipient?.phone || note.audience || note.ownerType || note.userId || 'Users';
}

function noteMatchesRole(note = {}, role = 'admin', context = {}) {
  if (['admin', 'support', 'finance', 'operations'].includes(role)) return true;
  const meta = note.meta || {};
  if (role === 'company') return note.ownerType === 'company' || note.audience === 'partners' || note.companyId === context.companyId || meta.companyId === context.companyId;
  if (role === 'employee' || role === 'driver') return note.companyId === context.companyId || meta.companyId === context.companyId || note.audience === 'staff';
  if (role === 'customer') {
    const targeted = Boolean(note.userId || note.ownerId || note.recipient?.email || note.recipient?.phone);
    const ownsNote = note.userId === context.customerId
      || note.ownerId === context.customerId
      || (context.email && note.recipient?.email === context.email)
      || (context.phone && note.recipient?.phone === context.phone);
    return ownsNote || (!targeted && (note.ownerType === 'customer' || note.audience === 'customers'));
  }
  if (role === 'promoter') return note.ownerId === context.promoterId || note.ownerType === 'promoter' || note.audience === 'promoters' || meta.promoterId === context.promoterId;
  return true;
}


async function visibleNotifications(role = 'admin', context = {}, options = {}) {
  const limit = Math.min(500, Math.max(1, Number(options.limit || 120)));
  const rows = await notificationRepository.notifications.list({}, { sort: { createdAt: -1 }, limit: Math.max(limit * 4, 200) });
  return rows.filter((note) => noteMatchesRole(note, role, context)).slice(0, limit);
}

async function dashboardRowsLive(role = 'admin', context = {}, options = {}) {
  const rows = await visibleNotifications(role, context, options);
  return rows.map((note) => [
    note.title || note.subject || 'Classic Trip update',
    channelLabel(note),
    recipientLabel(note),
    String(note.sentCount || note.deliveredCount || 0),
    note.deliveryStatus || note.status || 'queued',
    note.status || 'queued',
    { entity: 'notification', id: note.id, label: note.title || note.subject || note.id, status: note.status || 'queued', detail: { notification: note }, actions: ['view', 'send', 'export'] },
  ]);
}

async function unreadCountLive(role = 'admin', context = {}) {
  const rows = await visibleNotifications(role, context, { limit: 500 });
  return rows.filter((note) => !note.readAt && !['dismissed', 'archived'].includes(String(note.status || '').toLowerCase())).length;
}

function userNotificationContext(user = {}) {
  const role = user.role === 'super_admin' ? 'admin' : user.role === 'company_admin' ? 'company' : user.role === 'company_employee' ? 'employee' : user.role || 'customer';
  return { role, context: {
    customerId: user.id || '', promoterId: user.id || '', employeeId: user.id || '', companyId: user.companyId || '',
    email: user.email || '', phone: user.phone || '',
  } };
}

function publicNotification(note = {}) {
  return {
    id: note.id, title: note.title || note.subject || 'Classic Trip update', message: note.message || note.body || '',
    channel: note.channel, status: note.status, deliveryStatus: note.deliveryStatus, readAt: note.readAt || null,
    createdAt: note.createdAt, referenceType: note.referenceType || '', referenceId: note.referenceId || '', meta: note.meta || {},
  };
}

async function notificationsForUserLive(user = {}, options = {}) {
  const { role, context } = userNotificationContext(user);
  return (await visibleNotifications(role, context, options)).map(publicNotification);
}
async function markRead(notificationId, user = {}) {
  const note = await notificationRepository.notifications.findOne({ id: notificationId });
  if (!note) return null;
  const visible = (await notificationsForUserLive(user, { limit: 500 })).some((item) => item.id === notificationId);
  if (!visible && user.role !== 'super_admin') return null;
  note.readAt = new Date();
  await notificationRepository.notifications.save(note, { id: note.id });
  return note;
}

async function markAllRead(user = {}) {
  const visible = await notificationsForUserLive(user, { limit: 500 });
  const unreadIds = visible.filter((item) => !item.readAt).map((item) => item.id).filter(Boolean);
  if (!unreadIds.length) return { updated: 0 };
  const now = new Date();
  await notificationRepository.notifications.updateMany({ id: { $in: unreadIds } }, { $set: { readAt: now } });
  return { updated: unreadIds.length };
}

module.exports = {
  queueNotification,
  enqueueNotification,
  bookingConfirmed,
  enqueueBookingConfirmed,
  bookingOperationalRequests,
  bookingConfirmationChannels,
  hasCommunicationTicketAddon,
  paymentUpdated,
  refundApproved,
  employeeInvited,
  dashboardRowsLive,
  unreadCountLive,
  notificationsForUserLive,
  markRead,
  markAllRead,
};

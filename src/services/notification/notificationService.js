const store = require('../data/persistentStore');
const { mongoose } = require('../../config/db');
const { env } = require('../../config/env');
const ticketAccessService = require('../booking/ticketAccessService');
const { sendEmail } = require('./emailService');
const { sendSms } = require('./smsService');
const { sendWhatsapp } = require('./whatsappService');
const pushService = require('./pushService');

function mongoReady() {
  return mongoose.connection.readyState === 1;
}

async function persistNotifications(rows, attempts = []) {
  if (!mongoReady()) return;
  if (rows.length) {
    const Notification = require('../../models/Notification');
    await Notification.bulkWrite(rows.map((row) => ({
      updateOne: {
        filter: { id: row.id },
        update: { $set: row },
        upsert: true,
      },
    })));
  }
  if (attempts.length) {
    const NotificationDeliveryAttempt = require('../../models/NotificationDeliveryAttempt');
    await NotificationDeliveryAttempt.bulkWrite(attempts.map((attempt) => ({
      updateOne: {
        filter: { id: attempt.id },
        update: { $set: attempt },
        upsert: true,
      },
    })));
  }
}

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

function nextNotificationId() {
  return `notification-${store.state.notifications.length + 1}`;
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
  ownerType = meta.ownerType || '',
  ownerId = meta.ownerId || userId || '',
  audience = meta.audience || '',
} = {}) {
  const cleanTitle = cleanText(title || 'Classic Trip update');
  const cleanMessage = cleanText(message || '');
  const rows = [];
  const deliveryTasks = [];
  const attempts = [];
  const uniqueChannels = Array.from(new Set(Array.isArray(channels) ? channels : [channels])).filter(Boolean);

  for (const channel of uniqueChannels) {
    const row = {
      id: nextNotificationId(),
      userId,
      channel,
      title: cleanTitle,
      message: cleanMessage,
      recipient,
      ownerType,
      ownerId,
      audience,
      referenceType,
      referenceId,
      meta,
      status: 'queued',
      deliveryStatus: 'queued',
      sentCount: 0,
      deliveredCount: 0,
      failedCount: 0,
      createdAt: new Date().toISOString(),
    };
    store.state.notifications.push(row);
    rows.push(row);

    const attempt = {
      id: `notification-attempt-${row.id}`,
      notificationId: row.id,
      referenceType,
      referenceId,
      bookingRef: meta.bookingRef || '',
      userId: userId || '',
      channel,
      recipient,
      provider: channel,
      status: 'queued',
      attemptedAt: new Date().toISOString(),
      metadata: meta,
    };
    attempts.push(attempt);
    if (channel === 'in_app') deliveryTasks.push({ row, attempt, promise: Promise.resolve({ status: 'sent', channel: 'in_app', provider: 'notification-center', response: 'Stored in notification center' }) });
    if (channel === 'push') deliveryTasks.push({ row, attempt, promise: pushService.sendPush({ userId, audience, title: cleanTitle, message: cleanMessage, recipient, referenceType, referenceId, meta }) });
    if (channel === 'email') deliveryTasks.push({ row, attempt, promise: sendEmail({ to: recipient.email, title: cleanTitle, message: cleanMessage, meta }) });
    if (channel === 'sms') deliveryTasks.push({ row, attempt, promise: sendSms({ to: recipient.phone, title: cleanTitle, message: cleanMessage, meta }) });
    if (channel === 'whatsapp') deliveryTasks.push({ row, attempt, promise: sendWhatsapp({ to: recipient.whatsapp || recipient.phone, title: cleanTitle, message: cleanMessage, meta }) });
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

async function bookingConfirmed(booking) {
  const ticketPath = ticketAccessService.ticketUrl(booking);
  return queueNotification({
    userId: booking.customerUserId || null,
    channels: ['in_app', 'push', 'email', 'whatsapp'],
    title: `Booking confirmed ${booking.bookingRef}`,
    message: `Your Classic Trip booking ${booking.bookingRef} is confirmed. Ticket: ${env.appUrl}${ticketPath}`,
    recipient: bookingRecipient(booking),
    ownerType: booking.customerUserId ? 'customer' : 'guest',
    ownerId: booking.customerUserId || booking.guestSnapshot?.email || booking.guestSnapshot?.phone || '',
    audience: 'customers',
    referenceType: 'booking',
    referenceId: booking.id,
    meta: { bookingRef: booking.bookingRef, companyId: booking.companyId, ticketUrl: ticketPath, url: ticketPath },
  });
}

async function paymentUpdated(booking, payment) {
  return queueNotification({
    userId: booking.customerUserId || null,
    channels: ['in_app', 'push', 'email', 'whatsapp'],
    title: `Payment ${payment.status}`,
    message: `Payment for booking ${booking.bookingRef} is ${payment.status}.`,
    recipient: bookingRecipient(booking),
    referenceType: 'payment',
    referenceId: payment.id,
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

function dashboardRows(role = 'admin', context = {}, options = {}) {
  const limit = Number(options.limit || 120);
  return (store.state.notifications || [])
    .filter((note) => noteMatchesRole(note, role, context))
    .slice(0, limit)
    .map((note) => [
      note.title || note.subject || 'Classic Trip update',
      channelLabel(note),
      recipientLabel(note),
      String(note.sentCount || note.deliveredCount || 0),
      note.deliveryStatus || note.status || 'queued',
      note.status || 'queued',
      { entity: 'notification', id: note.id, label: note.title || note.subject || note.id, status: note.status || 'queued', detail: { notification: note }, actions: ['view', 'send', 'export'] },
    ]);
}

function unreadCount(role = 'admin', context = {}) {
  return (store.state.notifications || [])
    .filter((note) => noteMatchesRole(note, role, context))
    .filter((note) => !note.readAt && !['dismissed', 'archived'].includes(String(note.status || '').toLowerCase()))
    .length;
}

function notificationsForUser(user = {}, options = {}) {
  const role = user.role === 'super_admin' ? 'admin' : user.role === 'company_admin' ? 'company' : user.role === 'company_employee' ? 'employee' : user.role || 'customer';
  const context = {
    customerId: user.id || '',
    promoterId: user.id || '',
    employeeId: user.id || '',
    companyId: user.companyId || '',
    email: user.email || '',
    phone: user.phone || '',
  };
  const limit = Number(options.limit || 30);
  return (store.state.notifications || [])
    .filter((note) => noteMatchesRole(note, role, context))
    .slice(0, limit)
    .map((note) => ({
      id: note.id,
      title: note.title || note.subject || 'Classic Trip update',
      message: note.message || note.body || '',
      channel: note.channel,
      status: note.status,
      deliveryStatus: note.deliveryStatus,
      readAt: note.readAt || null,
      createdAt: note.createdAt,
      referenceType: note.referenceType || '',
      referenceId: note.referenceId || '',
      meta: note.meta || {},
    }));
}

async function markRead(notificationId, user = {}) {
  const note = (store.state.notifications || []).find((item) => item.id === notificationId);
  if (!note) return null;
  const visible = notificationsForUser(user, { limit: Number.MAX_SAFE_INTEGER }).some((item) => item.id === notificationId);
  if (!visible && user.role !== 'super_admin') return null;
  note.readAt = new Date().toISOString();
  note.status = note.status === 'queued' ? 'read' : note.status;
  if (mongoReady()) {
    const Notification = require('../../models/Notification');
    await Notification.updateOne({ id: note.id }, { $set: { readAt: note.readAt, status: note.status } });
  }
  return note;
}

module.exports = {
  queueNotification,
  bookingConfirmed,
  paymentUpdated,
  refundApproved,
  employeeInvited,
  dashboardRows,
  unreadCount,
  notificationsForUser,
  markRead,
};

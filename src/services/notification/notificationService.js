const store = require('../data/persistentStore');
const { mongoose } = require('../../config/db');
const { sendEmail } = require('./emailService');
const { sendSms } = require('./smsService');
const { sendWhatsapp } = require('./whatsappService');

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
    row.sentCount = row.status === 'sent' ? 1 : 0;
    row.deliveredCount = row.status === 'sent' ? 1 : 0;
    row.failedCount = row.status === 'failed' ? 1 : 0;
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
  return queueNotification({
    userId: booking.customerUserId || null,
    channels: ['email', 'sms', 'whatsapp'],
    title: `Booking confirmed ${booking.bookingRef}`,
    message: `Your Classic Trip booking ${booking.bookingRef} is confirmed.`,
    recipient: bookingRecipient(booking),
    referenceType: 'booking',
    referenceId: booking.id,
    meta: { bookingRef: booking.bookingRef },
  });
}

async function paymentUpdated(booking, payment) {
  return queueNotification({
    userId: booking.customerUserId || null,
    channels: ['email', 'sms'],
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
    channels: ['email', 'sms'],
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
    channels: ['email'],
    title: 'Classic Trip staff invite',
    message: `You have been invited as ${employee.roleTitle}.`,
    recipient: { email: user.email, phone: user.phone, name: user.fullName },
    referenceType: 'company_employee',
    referenceId: employee.id,
    meta: { companyId: employee.companyId, permissions: employee.permissions },
  });
}

module.exports = {
  queueNotification,
  bookingConfirmed,
  paymentUpdated,
  refundApproved,
  employeeInvited,
};

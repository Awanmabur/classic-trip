const store = require('../data/demoStore');
const { mongoose } = require('../../config/db');
const { sendEmail } = require('./emailService');
const { sendSms } = require('./smsService');
const { sendWhatsapp } = require('./whatsappService');

function mongoReady() {
  return mongoose.connection.readyState === 1;
}

async function persistNotifications(rows) {
  if (!mongoReady() || !rows.length) return;
  const Notification = require('../../models/Notification');
  await Notification.bulkWrite(rows.map((row) => ({
    updateOne: {
      filter: { id: row.id },
      update: { $set: row },
      upsert: true,
    },
  })));
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
  const deliveries = [];
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
      createdAt: new Date().toISOString(),
    };
    store.state.notifications.push(row);
    rows.push(row);

    if (channel === 'email') deliveries.push(sendEmail({ to: recipient.email, title: cleanTitle, message: cleanMessage, meta }));
    if (channel === 'sms') deliveries.push(sendSms({ to: recipient.phone, title: cleanTitle, message: cleanMessage, meta }));
    if (channel === 'whatsapp') deliveries.push(sendWhatsapp({ to: recipient.whatsapp || recipient.phone, title: cleanTitle, message: cleanMessage, meta }));
  }

  await Promise.all(deliveries);
  await persistNotifications(rows);
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

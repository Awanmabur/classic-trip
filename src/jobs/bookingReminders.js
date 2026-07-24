const commerceRepository = require('../repositories/domain/commerceRepository');
const notificationService = require('../services/notification/notificationService');
function recipient(booking = {}) { return { email: booking.guestSnapshot?.email, phone: booking.guestSnapshot?.phone, whatsapp: booking.guestSnapshot?.phone, name: booking.guestSnapshot?.fullName }; }
async function run() {
  const candidates = await commerceRepository.bookings.list({ bookingStatus: 'confirmed', $or: [{ reminderSentAt: { $exists: false } }, { reminderSentAt: null }, { reminderSentAt: '' }] }, { sort: { createdAt: 1 }, limit: 50 });
  const results = [];
  for (const booking of candidates) {
    const rows = await notificationService.queueNotification({ userId: booking.customerUserId || null, channels: ['email', 'sms', 'whatsapp'], title: `Upcoming Classic Trip booking ${booking.bookingRef}`, message: `Reminder: your booking ${booking.bookingRef} is confirmed. Keep your QR ticket ready for check-in.`, recipient: recipient(booking), referenceType: 'booking_reminder', referenceId: booking.id, meta: { bookingRef: booking.bookingRef } });
    booking.reminderSentAt = new Date().toISOString(); await commerceRepository.bookings.save(booking, { bookingRef: booking.bookingRef });
    results.push({ bookingRef: booking.bookingRef, notifications: rows.map((row) => row.id) });
  }
  return { queued: results.length, reminders: results };
}
module.exports = { run };

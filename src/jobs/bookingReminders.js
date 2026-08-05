'use strict';

const commerceRepository = require('../repositories/domain/commerceRepository');
const notificationService = require('../services/notification/notificationService');

const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;
const BATCH_LIMIT = 50;

function recipient(booking = {}) {
  return {
    email: booking.guestSnapshot?.email,
    phone: booking.guestSnapshot?.phone,
    whatsapp: booking.guestSnapshot?.phone,
    name: booking.guestSnapshot?.fullName,
  };
}

function validDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

async function serviceStartAt(booking = {}) {
  const serviceType = String(booking.serviceType || '').toLowerCase();
  if (serviceType === 'hotel') return validDate(booking.hotelStay?.checkIn || booking.bookingItems?.[0]?.checkIn);
  if (serviceType === 'flight') return validDate(booking.bookingLegs?.[0]?.departAt || booking.ticketLegs?.[0]?.departAt);
  if (serviceType === 'local_transport') return validDate(booking.bookingLegs?.[0]?.scheduledPickupAt || booking.ticketLegs?.[0]?.scheduledPickupAt);
  if (serviceType === 'tour' || serviceType === 'car_rental' || serviceType === 'cargo') {
    return validDate(booking.serviceReservation?.startAt || booking.serviceReservation?.date || booking.bookingItems?.[0]?.startAt);
  }
  if (serviceType === 'bus' && booking.scheduleId) {
    const schedule = await commerceRepository.schedules.findOne({ id: booking.scheduleId, companyId: booking.companyId });
    return validDate(schedule?.departAt);
  }
  return validDate(booking.bookingLegs?.[0]?.departAt);
}

async function reminderIsDue(booking, at = new Date()) {
  const serviceAt = await serviceStartAt(booking);
  if (!serviceAt) return { due: false, serviceAt: null };
  const delta = serviceAt.getTime() - at.getTime();
  return { due: delta >= 0 && delta <= REMINDER_WINDOW_MS, serviceAt };
}

async function run(at = new Date()) {
  const candidates = await commerceRepository.bookings.list({
    bookingStatus: 'confirmed',
    paymentStatus: 'successful',
    $and: [
      { $or: [{ reminderSentAt: { $exists: false } }, { reminderSentAt: null }, { reminderSentAt: '' }] },
      { $or: [{ reminderQueuedAt: { $exists: false } }, { reminderQueuedAt: null }, { reminderQueuedAt: '' }] },
    ],
  }, { sort: { createdAt: 1 }, limit: 500 });
  const results = [];
  for (const booking of candidates) {
    if (results.length >= BATCH_LIMIT) break;
    // eslint-disable-next-line no-await-in-loop
    const { due, serviceAt } = await reminderIsDue(booking, at);
    if (!due) continue;
    // eslint-disable-next-line no-await-in-loop
    const event = await notificationService.enqueueNotification({
      userId: booking.customerUserId || null,
      channels: ['email', 'sms', 'whatsapp'],
      title: `Upcoming Classic Trip booking ${booking.bookingRef}`,
      message: `Reminder: your booking ${booking.bookingRef} starts ${serviceAt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}. Keep your ticket or voucher ready.`,
      recipient: recipient(booking),
      referenceType: 'booking_reminder',
      referenceId: booking.id,
      dedupeKey: `booking-reminder:${booking.id}:${serviceAt.toISOString()}`,
      meta: { bookingRef: booking.bookingRef, serviceAt: serviceAt.toISOString() },
    }, {
      aggregateType: 'booking',
      aggregateId: booking.id,
      companyId: booking.companyId || '',
      dedupeKey: `booking-reminder:${booking.id}:${serviceAt.toISOString()}`,
    });
    booking.reminderQueuedAt = at.toISOString();
    booking.reminderServiceAt = serviceAt.toISOString();
    // eslint-disable-next-line no-await-in-loop
    await commerceRepository.bookings.save(booking, { bookingRef: booking.bookingRef });
    results.push({ bookingRef: booking.bookingRef, serviceAt: serviceAt.toISOString(), notificationEventId: event.id });
  }
  return { considered: candidates.length, queued: results.length, reminders: results };
}

module.exports = { run, serviceStartAt, reminderIsDue, REMINDER_WINDOW_MS, BATCH_LIMIT };

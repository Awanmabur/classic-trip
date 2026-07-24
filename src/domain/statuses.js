'use strict';

const BOOKING_STATUSES = Object.freeze([
  'draft',
  'pending',
  'pending_payment',
  'confirmed',
  'checked_in',
  'checked_out',
  'booked',
  'completed',
  'cancelled',
  'refunded',
  'voided',
  'no_show',
  'rescheduled',
  'partially_checked_in',
  'partially_refunded',
  'failed',
  'expired',
]);

const ROOM_NIGHT_STATUSES = Object.freeze([
  'available',
  'held',
  'booked',
  'occupied',
  'checked_in',
  'checked_out',
  'maintenance',
  'cleaning',
  'cancelled',
  'refunded',
  'reserved',
  'open',
]);

const ROOM_CHECK_IN_STATUSES = Object.freeze([
  'not_checked',
  'checked_in',
  'checked_out',
  '',
]);

function normalizeLifecycleStatus(value = '') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  const aliases = {
    check_in: 'checked_in',
    check_out: 'checked_out',
    no_showed: 'no_show',
    inhouse: 'in_house',
  };

  return aliases[normalized] || normalized;
}

module.exports = {
  BOOKING_STATUSES,
  ROOM_NIGHT_STATUSES,
  ROOM_CHECK_IN_STATUSES,
  normalizeLifecycleStatus,
};

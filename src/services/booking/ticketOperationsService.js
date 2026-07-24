const crypto = require('crypto');
const commerceRepository = require('../../repositories/domain/commerceRepository');
const { nextId } = require('../data/idService');

function normalize(value) { return String(value || '').trim().toLowerCase(); }
function cleanText(value, max = 1000) { return String(value || '').replace(/<[^>]*>/g, '').trim().replace(/\s+/g, ' ').slice(0, max); }
function hash(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }

function findTicket(booking, value) {
  const key = normalize(value); const hashed = normalize(hash(value));
  return (booking.ticketLegs || []).find((ticket) =>
    (ticket.qrTokenHash && normalize(ticket.qrTokenHash) === hashed)
    || [ticket.id, ticket.ticketNumber, ticket.qrToken].some((field) => normalize(field) === key)
  ) || null;
}
function matchesBooking(booking, value) {
  const key = normalize(value);
  return [booking.id, booking.bookingRef, booking.guestLookupCode, booking.qrCodeValue, booking.paymentRef].some((field) => normalize(field) === key);
}
async function search(value, companyId = '') {
  const rows = await commerceRepository.bookings.list(companyId ? { companyId } : {});
  for (const booking of rows) {
    const ticket = findTicket(booking, value);
    if (ticket || matchesBooking(booking, value)) return { booking, ticket };
  }
  return { booking: null, ticket: null };
}
function blockReason(booking, ticket) {
  if (!booking) return 'Booking was not found';
  if (booking.paymentStatus !== 'successful') return 'Ticket payment is not confirmed';
  if (['cancelled', 'refunded', 'voided'].includes(booking.bookingStatus)) return `Ticket is ${booking.bookingStatus}`;
  if (ticket && ['checked_in', 'used'].includes(normalize(ticket.checkInStatus || ticket.status))) return 'Ticket leg is already used';
  if (ticket && ['cancelled', 'refunded', 'voided', 'no_show'].includes(normalize(ticket.checkInStatus || ticket.status))) return `Ticket leg is ${ticket.checkInStatus || ticket.status}`;
  if (!ticket && ['checked_in', 'partially_checked_in'].includes(booking.bookingStatus)) return 'Ticket is already checked in';
  if (booking.bookingStatus === 'completed') return 'Trip or service is already completed';
  if (booking.bookingStatus === 'no_show') return 'Ticket is marked as no-show';
  return '';
}
function updatePassenger(booking, ticket, status) {
  const passenger = (booking.passengers || [])[Number(ticket?.passengerIndex || 0)];
  if (passenger) Object.assign(passenger, { checkInStatus: status, ticketNumber: ticket?.ticketNumber || passenger.ticketNumber, scheduleId: ticket?.scheduleId || passenger.scheduleId });
}
function progress(booking) {
  const legs = booking.ticketLegs || [];
  return { allCheckedIn: legs.length ? legs.every((leg) => leg.checkInStatus === 'checked_in') : booking.checkInStatus === 'checked_in', allClosed: legs.length ? legs.every((leg) => ['checked_in', 'no_show', 'cancelled', 'refunded', 'voided'].includes(normalize(leg.checkInStatus || leg.status))) : false };
}
async function listingFor(booking) { return booking ? commerceRepository.listings.findOne({ id: booking.listingId }) : null; }
async function scopedSearch(value, companyId) {
  const scoped = await search(value, companyId);
  if (scoped.booking) return scoped;
  if (companyId) {
    const unrestricted = await search(value, '');
    if (unrestricted.booking) return { ...scoped, unauthorizedBooking: unrestricted.booking };
  }
  return scoped;
}
async function lookup(value, companyId = '') {
  const { booking, ticket, unauthorizedBooking } = await scopedSearch(value, companyId);
  if (unauthorizedBooking) return { ok: false, result: 'not_authorized_for_ticket', booking: null, ticket: null, bookingRef: unauthorizedBooking.bookingRef, message: 'This ticket belongs to another company scope', canCheckIn: false, disabledReason: 'Wrong company scope' };
  if (!booking) return { ok: false, result: 'not_found', message: 'Ticket not found', canCheckIn: false, disabledReason: 'Ticket not found' };
  const activeTicket = ticket || (booking.ticketLegs || [])[0] || null;
  const reason = blockReason(booking, activeTicket);
  return { ok: !reason, result: reason ? 'blocked' : 'ready', message: reason || (activeTicket ? 'Ticket leg found and ready for check-in' : 'Ticket found and ready for check-in'), canCheckIn: !reason, disabledReason: reason, booking, ticket: activeTicket, listing: await listingFor(booking) };
}
async function audit(booking, ticket, employeeId, action, context, beforeSummary, afterSummary) {
  const row = { id: await nextId('audit'), actorId: employeeId, actorRole: context.actorRole || 'company_employee', actorName: context.actorName || '', actorEmail: context.actorEmail || '', action, target: ticket?.ticketNumber || booking.bookingRef, entityType: ticket ? 'ticket_leg' : 'booking', entityId: ticket?.id || booking.id, beforeSummary, afterSummary, ip: context.ip || '', userAgent: context.userAgent || '', status: 'success', createdAt: new Date().toISOString() };
  await commerceRepository.auditLogs.save(row, { id: row.id });
}
async function validate(value, employeeId = 'employee-system', companyId = '', context = {}) {
  const result = await lookup(value, companyId);
  if (!result.booking) return result;
  if (!result.ok) {
    if (result.booking.paymentStatus !== 'successful') result.result = 'payment_not_successful';
    else if (/already|completed/i.test(result.message)) result.result = 'already_used';
    return result;
  }
  const booking = result.booking; const ticket = result.ticket; const now = new Date().toISOString();
  if (ticket) Object.assign(ticket, { checkInStatus: 'checked_in', status: 'used', usedAt: now, checkedInAt: now, checkedInBy: employeeId, source: context.source || ticket.source || '', location: context.location || ticket.location || '' });
  updatePassenger(booking, ticket, 'checked_in');
  const state = progress(booking);
  Object.assign(booking, { bookingStatus: state.allCheckedIn || !ticket ? 'checked_in' : 'partially_checked_in', checkInStatus: state.allCheckedIn || !ticket ? 'checked_in' : 'partial', checkedInAt: booking.checkedInAt || now, checkedInBy: employeeId, checkedInByUserId: employeeId });
  await commerceRepository.bookings.save(booking, { bookingRef: booking.bookingRef });
  await audit(booking, ticket, employeeId, 'ticket.checked_in', context, 'Ticket leg was eligible for check-in', ticket ? `Ticket leg ${ticket.ticketNumber} marked checked_in` : 'Ticket marked checked_in');
  return { ok: true, result: 'validated', booking, ticket, listing: await listingFor(booking), message: ticket ? 'Ticket leg validated and checked in' : 'Ticket validated and checked in', canCheckIn: false, disabledReason: ticket ? 'Ticket leg is already used' : 'Ticket is already checked in' };
}
async function markNoShow(value, employeeId = 'employee-system', companyId = '', note = '', context = {}) {
  const { booking, ticket, unauthorizedBooking } = await scopedSearch(value, companyId);
  if (unauthorizedBooking) return { ok: false, result: 'not_authorized_for_ticket', booking: null, ticket: null, bookingRef: unauthorizedBooking.bookingRef, message: 'This ticket belongs to another company scope' };
  if (!booking) return { ok: false, result: 'not_found', message: 'Ticket not found' };
  const activeTicket = ticket || (booking.ticketLegs || [])[0] || null;
  if (['cancelled', 'refunded', 'voided', 'completed'].includes(booking.bookingStatus) || (activeTicket && ['checked_in', 'used', 'cancelled', 'refunded', 'voided'].includes(normalize(activeTicket.checkInStatus || activeTicket.status)))) return { ok: false, result: 'not_valid_for_no_show', booking, ticket: activeTicket, message: activeTicket ? `Cannot mark ${activeTicket.checkInStatus || activeTicket.status} ticket leg as no-show` : `Cannot mark ${booking.bookingStatus} booking as no-show` };
  const now = new Date().toISOString(); const safeNote = cleanText(note);
  if (activeTicket) Object.assign(activeTicket, { checkInStatus: 'no_show', status: 'no_show', noShowAt: now, noShowBy: employeeId });
  updatePassenger(booking, activeTicket, 'no_show');
  const state = progress(booking);
  Object.assign(booking, { bookingStatus: state.allClosed || !activeTicket ? 'no_show' : 'partially_checked_in', checkInStatus: state.allClosed || !activeTicket ? 'no_show' : 'partial', noShowAt: now, noShowBy: employeeId, noShowByUserId: employeeId, checkInNote: safeNote || booking.checkInNote || 'Marked no-show from employee dashboard' });
  await commerceRepository.bookings.save(booking, { bookingRef: booking.bookingRef });
  await audit(booking, activeTicket, employeeId, 'ticket.no_show', context, 'Ticket was not checked in', `${activeTicket ? 'Ticket leg' : 'Ticket'} marked no_show${safeNote ? `: ${safeNote}` : ''}`);
  return { ok: true, result: 'no_show', booking, ticket: activeTicket, listing: await listingFor(booking), message: activeTicket ? 'Ticket leg marked as no-show' : 'Booking marked as no-show' };
}

module.exports = { lookup, validate, markNoShow };

const crypto = require('crypto');
const operationsRepository = require('../../repositories/domain/operationsRepository');
const { nextId } = require('../data/idService');
async function recordScan(scanType, scannedToken, result = {}, context = {}) {
  const booking = result.booking || {}; const ticket = result.ticket || {};
  const scan = { id: await nextId('ticket-scan'), scanType, scannedToken: crypto.createHash('sha256').update(String(scannedToken || '')).digest('hex'), bookingId: booking.id || '', bookingRef: booking.bookingRef || '', ticketNumber: ticket.ticketNumber || '', ticketLegId: ticket.id || '', scheduleId: ticket.scheduleId || context.scheduleId || booking.scheduleId || '', seatNumber: ticket.seatNumber || '', qrTokenPreview: ticket.qrTokenPreview || '', qrCodeValue: ticket.qrTokenPreview || booking.qrCodeValue || (/^CLASSIC-TRIP:/i.test(String(scannedToken || '')) ? 'hashed-scan-token' : ''), employeeId: context.userId || context.employeeId || '', companyId: context.companyId || booking.companyId || '', result: result.result || (result.ok ? 'validated' : 'not_valid_for_checkin'), ok: Boolean(result.ok), message: result.message || '', scannedAt: new Date().toISOString(), ip: context.ip || '', userAgent: context.userAgent || '', actorRole: context.actorRole || '', actorName: context.actorName || '', actorEmail: context.actorEmail || '', note: context.note || '', source: context.source || '', location: context.location || '', meta: { canCheckIn: result.canCheckIn, disabledReason: result.disabledReason, releasedCommissions: result.releasedCommissions || [], ticketStatus: ticket.status || '', checkInStatus: ticket.checkInStatus || booking.checkInStatus || '' } };
  await operationsRepository.ticketScans.save(scan, { id: scan.id });
  if (booking.bookingRef) {
    const persisted = await operationsRepository.bookings.findOne({ bookingRef: booking.bookingRef });
    if (persisted) { persisted.scanHistory = [scan, ...(persisted.scanHistory || [])].slice(0, 100); await operationsRepository.bookings.save(persisted, { bookingRef: persisted.bookingRef }); }
  }
  return scan;
}
module.exports = { recordScan };

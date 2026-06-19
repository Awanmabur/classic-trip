const crypto = require('crypto');
const store = require('../data/persistentStore');
const repositories = require('../../repositories');

function ensureScans() {
  if (!Array.isArray(store.state.ticketScans)) store.state.ticketScans = [];
}

function nextId() {
  ensureScans();
  return `ticket-scan-${store.state.ticketScans.length + 1}-${Date.now().toString(36)}`;
}

async function persistScan(scan) {
  await repositories.ticketScans.upsert(scan);
}

async function recordScan(scanType, scannedToken, result = {}, context = {}) {
  ensureScans();
  const booking = result.booking || {};
  const ticket = result.ticket || {};
  const scan = {
    id: nextId(),
    scanType,
    scannedToken: crypto.createHash('sha256').update(String(scannedToken || '')).digest('hex'),
    bookingId: booking.id || '',
    bookingRef: booking.bookingRef || '',
    ticketNumber: ticket.ticketNumber || '',
    ticketLegId: ticket.id || '',
    scheduleId: ticket.scheduleId || context.scheduleId || booking.scheduleId || '',
    seatNumber: ticket.seatNumber || '',
    qrTokenPreview: ticket.qrTokenPreview || '',
    qrCodeValue: ticket.qrTokenPreview || booking.qrCodeValue || (/^CLASSIC-TRIP:/i.test(String(scannedToken || '')) ? 'hashed-scan-token' : ''),
    employeeId: context.userId || context.employeeId || '',
    companyId: context.companyId || booking.companyId || '',
    result: result.result || (result.ok ? 'validated' : 'not_valid_for_checkin'),
    ok: Boolean(result.ok),
    message: result.message || '',
    scannedAt: new Date().toISOString(),
    ip: context.ip || '',
    userAgent: context.userAgent || '',
    actorRole: context.actorRole || '',
    actorName: context.actorName || '',
    actorEmail: context.actorEmail || '',
    note: context.note || '',
    source: context.source || '',
    location: context.location || '',
    meta: {
      canCheckIn: result.canCheckIn,
      disabledReason: result.disabledReason,
      releasedCommissions: result.releasedCommissions || [],
      ticketStatus: ticket.status || '',
      checkInStatus: ticket.checkInStatus || booking.checkInStatus || '',
    },
  };
  store.state.ticketScans.unshift(scan);
  if (booking.bookingRef) {
    if (!Array.isArray(booking.scanHistory)) booking.scanHistory = [];
    booking.scanHistory.unshift(scan);
  }
  await persistScan(scan);
  return scan;
}

module.exports = { recordScan };

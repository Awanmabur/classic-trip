'use strict';

const repository = require('../repositories/busRepository');
const inventoryService = require('./busInventoryService');
const departureService = require('./busDepartureService');
const timelineService = require('../../../services/support/timelineService');
const {
  cleanText,
  normalize,
  validationError,
  conflictError,
  hashToken,
  tokenPreview,
} = require('../domain/busDomain');

function nowIso() { return new Date().toISOString(); }
function actorId(value) { return cleanText(value || 'operator', 180); }

async function recordOperationalTimeline(booking = {}, ticket = {}, employee = {}, action, title, message, status, metadata = {}) {
  if (!booking?.bookingRef) return null;
  return timelineService.recordEvent({
    bookingRef: booking.bookingRef,
    bookingId: booking.id,
    companyId: booking.companyId || ticket.companyId || employee.companyId || '',
    customerUserId: booking.customerUserId || '',
    entityType: 'bus_ticket',
    entityId: ticket.id || ticket.ticketNumber || booking.bookingRef,
    action,
    title,
    message,
    status,
    actorType: 'employee',
    actorId: employee.id || employee.userId || 'bus-operations',
    actorName: employee.fullName || employee.roleTitle || 'Bus operations',
    visibility: 'shared',
    metadata: { scheduleId: ticket.scheduleId || '', seatNumber: ticket.seatNumber || '', ticketNumber: ticket.ticketNumber || '', ...metadata },
  }).catch(() => null);
}

async function assertOperator(companyId, employeeId, scheduleId, requiredPermission = '') {
  const identityId = cleanText(employeeId, 180);
  let employee = await repository.employees.findOne({ companyId, status: 'active', $or: [{ id: identityId }, { userId: identityId }] });
  if (!employee) {
    const user = await repository.users.findOne({ id: identityId, companyId, status: 'active', role: { $in: ['company_admin', 'super_admin'] } });
    if (user) employee = { id: user.id, userId: user.id, companyId, roleTitle: user.role, permissions: ['manage_all'], fullName: user.fullName, email: user.email };
  }
  if (!employee) throw validationError('Active company operator not found', 403);
  if (Array.isArray(employee.scheduleIds) && employee.scheduleIds.length && !employee.scheduleIds.includes(scheduleId)) throw validationError('Employee is not assigned to this departure', 403);
  if (requiredPermission && Array.isArray(employee.permissions) && employee.permissions.length && !employee.permissions.includes(requiredPermission) && !employee.permissions.includes('manage_all')) throw validationError('Employee does not have the required operation permission', 403);
  return employee;
}

async function manifest(companyId, scheduleId) {
  const schedule = await repository.scheduleOrThrow(companyId, scheduleId);
  const [company, listing, route, vehicle, seats, tickets, assignments, reservations, driverAssignments] = await Promise.all([
    repository.companyOrThrow(companyId),
    repository.listings.findOne({ id: schedule.listingId, companyId }),
    repository.routes.findOne({ id: schedule.routeId, companyId }),
    repository.vehicles.findOne({ id: schedule.vehicleId, companyId }),
    repository.seats.list({ companyId, scheduleId }, { sort: { seatNumber: 1 } }),
    repository.tickets.list({ companyId, scheduleId }, { sort: { seatNumber: 1 } }),
    repository.seatAssignments.list({ companyId, scheduleId }),
    repository.reservations.list({ companyId, scheduleId }),
    repository.driverAssignments.list({ companyId, scheduleId, status: 'active' }),
  ]);
  const passengerIds = [...new Set(tickets.map((ticket) => ticket.passengerId))];
  const passengers = passengerIds.length ? await repository.passengers.list({ id: { $in: passengerIds }, companyId }) : [];
  const bookings = reservations.length ? await repository.bookings.list({ id: { $in: reservations.map((reservation) => reservation.bookingId) }, companyId }) : [];
  const passengerMap = new Map(passengers.map((row) => [row.id, row]));
  const assignmentMap = new Map(assignments.map((row) => [row.id, row]));
  const bookingMap = new Map(bookings.map((row) => [row.id, row]));
  const reservationMap = new Map(reservations.map((row) => [row.id, row]));
  const rows = tickets.map((ticket) => {
    const passenger = passengerMap.get(ticket.passengerId) || {};
    const assignment = assignmentMap.get(ticket.seatAssignmentId) || {};
    const reservation = reservationMap.get(ticket.reservationId) || {};
    const booking = bookingMap.get(ticket.bookingId) || {};
    return {
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      bookingId: ticket.bookingId,
      bookingRef: ticket.bookingRef,
      reservationId: ticket.reservationId,
      passengerId: ticket.passengerId,
      passengerName: passenger.fullName || booking.guestSnapshot?.fullName || 'Passenger',
      phone: passenger.phone || booking.guestSnapshot?.phone || '',
      email: passenger.email || booking.guestSnapshot?.email || '',
      identityType: passenger.identityType || '',
      identityNumber: passenger.identityNumber || '',
      seatNumber: ticket.seatNumber,
      originStopId: ticket.originStopId,
      destinationStopId: ticket.destinationStopId,
      pickupPoint: passenger.pickupPoint || reservation.routeSnapshot?.journey?.originName || '',
      dropoffPoint: passenger.dropoffPoint || reservation.routeSnapshot?.journey?.destinationName || '',
      luggageCount: Number(passenger.luggageCount || 0),
      specialNotes: passenger.specialNotes || '',
      ticketStatus: ticket.status,
      checkInStatus: ticket.checkInStatus,
      assignmentStatus: assignment.status,
      paymentStatus: booking.paymentStatus,
      bookingStatus: booking.bookingStatus,
      checkedInAt: ticket.checkedInAt || null,
      booking,
      passenger,
      ticket,
    };
  });
  return {
    companyId,
    company,
    schedule,
    listing: listing || {},
    route: route || {},
    vehicle: vehicle || {},
    crew: driverAssignments,
    passengers: rows,
    seats,
    stats: {
      passengers: rows.length,
      validTickets: rows.filter((row) => row.ticketStatus === 'valid').length,
      checkedIn: rows.filter((row) => row.checkInStatus === 'checked_in').length,
      noShows: rows.filter((row) => row.checkInStatus === 'no_show').length,
      pending: rows.filter((row) => row.checkInStatus === 'not_checked').length,
    },
    generatedAt: nowIso(),
  };
}

async function findTicketForScan(companyId, value) {
  const token = cleanText(value, 500);
  if (!token) throw validationError('Ticket number, booking reference or QR token is required');
  let ticket = await repository.tickets.findOne({ companyId, $or: [{ ticketNumber: token }, { id: token }, { bookingRef: token }] });
  if (!ticket && token.length >= 20) ticket = await repository.tickets.findOne({ companyId, qrTokenHash: hashToken(token) });
  return ticket;
}

async function lookupTicket({ companyId, scannedToken, scheduleId = '' } = {}) {
  const ticket = await findTicketForScan(companyId, scannedToken);
  if (!ticket) return { ok: false, result: 'not_found', message: 'Ticket not found', canCheckIn: false, disabledReason: 'Ticket not found' };
  if (scheduleId && ticket.scheduleId !== scheduleId) return { ok: false, result: 'not_authorized_for_ticket', message: 'Ticket belongs to another departure', canCheckIn: false, disabledReason: 'Wrong departure', ticket: null, booking: null };
  const [booking, listing] = await Promise.all([
    repository.bookings.findOne({ id: ticket.bookingId, companyId, serviceType: 'bus' }),
    repository.listings.findOne({ id: ticket.listingId, companyId, serviceType: 'bus' }),
  ]);
  if (!booking) return { ok: false, result: 'not_found', message: 'Bus booking not found', canCheckIn: false, disabledReason: 'Booking not found' };
  let reason = '';
  let result = 'ready';
  if (booking.paymentStatus !== 'successful') { reason = 'Ticket payment is not confirmed'; result = 'payment_not_successful'; }
  else if (ticket.status !== 'valid') { reason = `Ticket is ${ticket.status}`; result = ticket.status === 'used' ? 'already_used' : 'not_valid_for_checkin'; }
  else if (ticket.checkInStatus === 'checked_in') { reason = 'Passenger is already checked in'; result = 'already_used'; }
  else if (ticket.checkInStatus === 'no_show') { reason = 'Passenger is marked as no-show'; result = 'not_valid_for_checkin'; }
  return {
    ok: !reason,
    result,
    message: reason || 'Bus ticket is ready for check-in',
    canCheckIn: !reason,
    disabledReason: reason,
    ticket,
    booking,
    listing: listing || {},
  };
}

async function recordScan({ ticket, scannedToken, scanType, result, ok, message, employee, req = {}, note = '', location = '' }) {
  const row = {
    id: await repository.nextId('ticket-scan'),
    scanType,
    scannedToken: cleanText(scannedToken, 500),
    bookingId: ticket?.bookingId || '',
    bookingRef: ticket?.bookingRef || '',
    ticketNumber: ticket?.ticketNumber || '',
    ticketLegId: ticket?.id || '',
    scheduleId: ticket?.scheduleId || '',
    seatNumber: ticket?.seatNumber || '',
    qrTokenPreview: tokenPreview(scannedToken),
    qrCodeValue: ticket?.qrTokenHash || '',
    employeeId: employee?.id || '',
    companyId: employee?.companyId || ticket?.companyId || '',
    result,
    ok,
    message: cleanText(message, 500),
    scannedAt: nowIso(),
    ip: cleanText(req.ip, 80),
    userAgent: cleanText(req.headers?.['user-agent'], 300),
    actorRole: cleanText(employee?.roleTitle, 100),
    actorName: cleanText(employee?.fullName || employee?.roleTitle, 180),
    actorEmail: cleanText(employee?.email, 254),
    note: cleanText(note, 500),
    source: 'canonical_bus_scanner',
    location: cleanText(location, 300),
    meta: {},
  };
  await repository.ticketScans.save(row, { id: row.id });
  return row;
}

async function validateTicket({ companyId, employeeId, scannedToken, scheduleId = '', req = {}, note = '', location = '' } = {}) {
  const ticket = await findTicketForScan(companyId, scannedToken);
  const employee = await assertOperator(companyId, employeeId, scheduleId || ticket?.scheduleId || '', 'ticket_checkin');
  if (!ticket) {
    await recordScan({ ticket: null, scannedToken, scanType: 'validate', result: 'not_found', ok: false, message: 'Ticket not found', employee, req, note, location });
    throw validationError('Ticket not found', 404);
  }
  if (scheduleId && ticket.scheduleId !== scheduleId) {
    await recordScan({ ticket, scannedToken, scanType: 'validate', result: 'not_authorized_for_ticket', ok: false, message: 'Ticket belongs to another departure', employee, req, note, location });
    throw validationError('Ticket belongs to another departure', 403);
  }
  const booking = await repository.bookings.findOne({ id: ticket.bookingId, companyId, serviceType: 'bus' });
  if (!booking || booking.paymentStatus !== 'successful') {
    await recordScan({ ticket, scannedToken, scanType: 'validate', result: 'payment_not_successful', ok: false, message: 'Booking payment is not successful', employee, req, note, location });
    throw conflictError('Ticket payment is not successful', 'ticket_payment_not_successful');
  }
  if (ticket.status !== 'valid') {
    const result = ticket.status === 'used' ? 'already_used' : 'not_valid_for_checkin';
    await recordScan({ ticket, scannedToken, scanType: 'validate', result, ok: false, message: `Ticket is ${ticket.status}`, employee, req, note, location });
    throw conflictError(`Ticket is ${ticket.status}`, 'ticket_not_valid');
  }
  if (ticket.checkInStatus === 'checked_in') {
    await recordScan({ ticket, scannedToken, scanType: 'validate', result: 'already_used', ok: false, message: 'Passenger is already checked in', employee, req, note, location });
    throw conflictError('Passenger is already checked in', 'ticket_already_used');
  }
  const timestamp = nowIso();
  const assignment = await repository.seatAssignments.findOne({ id: ticket.seatAssignmentId, companyId });
  ticket.checkInStatus = 'checked_in';
  ticket.checkedInAt = timestamp;
  ticket.checkedInBy = employee.id;
  ticket.status = 'used';
  ticket.usedAt = timestamp;
  ticket.updatedAt = timestamp;
  if (assignment) { assignment.status = 'checked_in'; assignment.updatedAt = timestamp; }
  const siblingTickets = await repository.tickets.list({ bookingId: booking.id, companyId });
  const allCheckedIn = siblingTickets.every((row) => row.id === ticket.id || row.checkInStatus === 'checked_in');
  booking.checkInStatus = allCheckedIn ? 'checked_in' : 'partial';
  booking.checkedInAt = booking.checkedInAt || timestamp;
  booking.checkedInBy = employee.id;
  booking.checkedInByUserId = employee.userId || employee.id;
  booking.bookingStatus = allCheckedIn ? 'checked_in' : 'partially_checked_in';
  booking.updatedAt = timestamp;
  booking.ticketLegs = (booking.ticketLegs || []).map((leg) => leg.id === ticket.id ? { ...leg, status: 'used', checkInStatus: 'checked_in', checkedInAt: timestamp } : leg);
  const segmentRows = await repository.segmentInventory.list({ ticketId: ticket.id, status: 'booked' });
  for (const row of segmentRows) { row.status = 'checked_in'; row.updatedAt = timestamp; }
  await repository.withTransaction(async (session) => {
    await repository.tickets.save(ticket, { id: ticket.id }, { session });
    if (assignment) await repository.seatAssignments.save(assignment, { id: assignment.id }, { session });
    await repository.bookings.save(booking, { bookingRef: booking.bookingRef }, { session });
    if (segmentRows.length) await repository.segmentInventory.saveMany(segmentRows, null, { session });
    await inventoryService.recalculateCompatibilitySeat(ticket.scheduleId, ticket.seatNumber, session);
    await repository.outbox({ eventType: 'BusPassengerCheckedIn', aggregateType: 'bus_ticket', aggregateId: ticket.id, companyId, payload: { bookingRef: ticket.bookingRef, scheduleId: ticket.scheduleId, seatNumber: ticket.seatNumber }, dedupeKey: `BusPassengerCheckedIn:${ticket.id}`, session });
    await repository.audit({ actorId: employee.id, action: 'bus.ticket.checked_in', targetType: 'bus_ticket', targetId: ticket.id, companyId, metadata: { scheduleId: ticket.scheduleId, bookingRef: ticket.bookingRef, seatNumber: ticket.seatNumber }, session });
  });
  const scan = await recordScan({ ticket, scannedToken, scanType: 'validate', result: 'validated', ok: true, message: 'Passenger checked in', employee, req, note, location });
  await recordOperationalTimeline(booking, ticket, employee, 'ticket.checked_in', `Passenger checked in for ${booking.bookingRef}`, note || 'Passenger checked in successfully.', 'checked_in', { location: cleanText(location, 300) });
  return { ok: true, result: 'validated', message: 'Passenger checked in', canCheckIn: false, disabledReason: 'Ticket is already used', ticket, booking, assignment, scan };
}

async function markNoShow({ companyId, employeeId, ticketId = '', bookingRef = '', seatNumber = '', scheduleId, note = '', req = {} } = {}) {
  const employee = await assertOperator(companyId, employeeId, scheduleId, 'manifest_update');
  let ticket = null;
  if (ticketId) ticket = await repository.tickets.findOne({ id: ticketId, companyId, scheduleId });
  else if (bookingRef && seatNumber) ticket = await repository.tickets.findOne({ bookingRef, seatNumber, companyId, scheduleId });
  if (!ticket) throw validationError('Ticket not found for this departure', 404);
  if (!['valid', 'used'].includes(ticket.status) || !['not_checked', 'boarding'].includes(ticket.checkInStatus)) throw conflictError('Ticket is not eligible for no-show marking', 'not_valid_for_no_show');
  const schedule = await repository.scheduleOrThrow(companyId, scheduleId);
  if (!['departed', 'arrived', 'completed'].includes(schedule.status)) throw conflictError('No-show can only be marked after departure');
  const timestamp = nowIso();
  const assignment = await repository.seatAssignments.findOne({ id: ticket.seatAssignmentId, companyId });
  const booking = await repository.bookings.findOne({ id: ticket.bookingId, companyId });
  ticket.checkInStatus = 'no_show';
  ticket.noShowAt = timestamp;
  ticket.updatedAt = timestamp;
  if (assignment) { assignment.status = 'no_show'; assignment.updatedAt = timestamp; }
  if (booking) {
    const siblingTickets = await repository.tickets.list({ bookingId: booking.id, companyId });
    const allNoShow = siblingTickets.every((row) => row.id === ticket.id || row.checkInStatus === 'no_show');
    booking.checkInStatus = allNoShow ? 'no_show' : 'partial';
    if (allNoShow) booking.bookingStatus = 'no_show';
    booking.noShowAt = allNoShow ? timestamp : booking.noShowAt;
    booking.updatedAt = timestamp;
    booking.ticketLegs = (booking.ticketLegs || []).map((leg) => leg.id === ticket.id ? { ...leg, checkInStatus: 'no_show', noShowAt: timestamp } : leg);
  }
  const segmentRows = await repository.segmentInventory.list({ ticketId: ticket.id, status: { $in: ['booked', 'checked_in'] } });
  for (const row of segmentRows) { row.status = 'no_show'; row.updatedAt = timestamp; }
  await repository.withTransaction(async (session) => {
    await repository.tickets.save(ticket, { id: ticket.id }, { session });
    if (assignment) await repository.seatAssignments.save(assignment, { id: assignment.id }, { session });
    if (booking) await repository.bookings.save(booking, { bookingRef: booking.bookingRef }, { session });
    if (segmentRows.length) await repository.segmentInventory.saveMany(segmentRows, null, { session });
    await inventoryService.recalculateCompatibilitySeat(ticket.scheduleId, ticket.seatNumber, session);
    await repository.audit({ actorId: employee.id, action: 'bus.ticket.no_show', targetType: 'bus_ticket', targetId: ticket.id, companyId, metadata: { scheduleId, bookingRef: ticket.bookingRef, note: cleanText(note, 500) }, session });
  });
  const scan = await recordScan({ ticket, scannedToken: ticket.ticketNumber, scanType: 'no_show', result: 'no_show', ok: true, message: 'Passenger marked no-show', employee, req, note });
  await recordOperationalTimeline(booking, ticket, employee, 'ticket.no_show', `No-show marked for ${booking?.bookingRef || ticket.bookingRef}`, note || 'Passenger was marked as no-show.', 'no_show');
  return { ok: true, result: 'no_show', message: 'Passenger marked no-show', ticket, booking, assignment, scan };
}

async function assignCrew({ companyId, scheduleId, employeeId, assignmentRole = 'attendant', assignedBy = 'company-admin', note = '' } = {}) {
  const schedule = await repository.scheduleOrThrow(companyId, scheduleId);
  const employee = await repository.employees.findOne({ id: employeeId, companyId });
  if (!employee) throw validationError('Select a saved company employee');
  const role = normalize(assignmentRole);
  if (!['driver', 'co_driver', 'conductor', 'attendant', 'dispatcher'].includes(role)) throw validationError('Invalid crew assignment role');
  const existing = await repository.driverAssignments.findOne({ companyId, scheduleId, employeeId, assignmentRole: role, status: 'active' });
  if (existing) return existing;
  const row = {
    id: await repository.nextId('driver-assignment'),
    companyId,
    employeeId,
    driverUserId: employee.userId,
    vehicleId: schedule.vehicleId,
    scheduleId,
    routeId: schedule.routeId,
    listingId: schedule.listingId,
    assignmentType: 'schedule',
    assignmentRole: role,
    startsAt: schedule.boardingStartAt || schedule.departAt,
    endsAt: schedule.arriveAt || null,
    safetyStatus: employee.safetyStatus || 'not_submitted',
    status: 'active',
    note: cleanText(note, 600),
    assignedBy: actorId(assignedBy),
    createdAt: nowIso(),
  };
  await repository.driverAssignments.save(row, { id: row.id });
  await repository.audit({ actorId: actorId(assignedBy), action: 'bus.crew.assigned', targetType: 'driver_assignment', targetId: row.id, companyId, metadata: { scheduleId, employeeId, assignmentRole: role } });
  return row;
}

async function reportIncident({ companyId, scheduleId, employeeId, category = 'operations', severity = 'normal', title, description, location = '', bookingRef = '' } = {}) {
  const employee = await assertOperator(companyId, employeeId, scheduleId, 'incident_create');
  const schedule = await repository.scheduleOrThrow(companyId, scheduleId);
  const categoryValue = ['general', 'vehicle', 'safety', 'passenger', 'route', 'security', 'operations'].includes(normalize(category)) ? normalize(category) : 'operations';
  const severityValue = ['low', 'medium', 'normal', 'high', 'critical'].includes(normalize(severity)) ? normalize(severity) : 'normal';
  const row = {
    id: await repository.nextId('driver-incident'),
    companyId,
    scheduleId,
    bookingRef: cleanText(bookingRef, 180),
    vehicleId: schedule.vehicleId,
    driverUserId: employee.userId,
    category: categoryValue,
    severity: severityValue,
    title: cleanText(title || `${categoryValue} incident`, 180),
    description: cleanText(description, 3000),
    location: cleanText(location, 300),
    status: 'open',
    auditTrail: [{ at: nowIso(), action: 'created', actorId: employee.id }],
    createdAt: nowIso(),
  };
  if (!row.description) throw validationError('Incident description is required');
  await repository.withTransaction(async (session) => {
    await repository.incidents.save(row, { id: row.id }, { session });
    await repository.outbox({ eventType: 'BusIncidentReported', aggregateType: 'driver_incident', aggregateId: row.id, companyId, payload: { scheduleId, severity: row.severity, category: row.category }, dedupeKey: `BusIncidentReported:${row.id}`, session });
    await repository.audit({ actorId: employee.id, action: 'bus.incident.reported', targetType: 'driver_incident', targetId: row.id, companyId, metadata: { scheduleId, severity: row.severity }, session });
  });
  return row;
}

async function updateTripStatus({ companyId, scheduleId, employeeId, status, reason = '', location = '' } = {}) {
  await assertOperator(companyId, employeeId, scheduleId, 'trip_status_update');
  const schedule = await departureService.transitionSchedule(companyId, scheduleId, { status, reason, location }, employeeId);
  const currentManifest = await manifest(companyId, scheduleId);
  const latest = await repository.tripStatusUpdates.findOne({ companyId, scheduleId, status: schedule.status });
  if (latest) {
    latest.passengerCount = currentManifest.stats.passengers;
    latest.checkedInCount = currentManifest.stats.checkedIn;
    latest.noShowCount = currentManifest.stats.noShows;
    await repository.tripStatusUpdates.save(latest, { id: latest.id });
  }
  return { schedule, manifest: currentManifest };
}

module.exports = {
  assertOperator,
  manifest,
  findTicketForScan,
  lookupTicket,
  validateTicket,
  markNoShow,
  assignCrew,
  reportIncident,
  updateTripStatus,
};

const { platformCurrency } = require('../../utils/currency');
const PDFDocument = require('pdfkit');
const operationsRepository = require('../../repositories/domain/operationsRepository');
const timelineService = require('../support/timelineService');
const { evaluateDriverEligibility } = require('../company/driverEligibilityService');

function clean(value, fallback = '') { return String(value ?? fallback).replace(/<[^>]*>/g, '').trim(); }
function normalize(value) { return clean(value).toLowerCase(); }
function money(amount, currency = platformCurrency()) { return `${currency} ${Math.round(Number(amount) || 0).toLocaleString()}`; }
function asDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clean(value);
  return date.toLocaleString('en-UG', { dateStyle: 'medium', timeStyle: 'short' });
}
function dateKey(value) { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : ''; }
function serviceError(message, status = 404) { const error = new Error(message); error.status = status; return error; }

const collections = {
  users: operationsRepository.users,
  companies: operationsRepository.companies,
  employees: operationsRepository.employees,
  branches: operationsRepository.branches,
  listings: operationsRepository.listings,
  routes: operationsRepository.routes,
  routeStops: operationsRepository.routeStops,
  vehicles: operationsRepository.vehicles,
  schedules: operationsRepository.schedules,
  seats: operationsRepository.seats,
  bookings: operationsRepository.bookings,
  ticketScans: operationsRepository.ticketScans,
  supportTickets: operationsRepository.supportTickets,
  refunds: operationsRepository.refunds,
  rescheduleRequests: operationsRepository.rescheduleRequests,
  timelineEvents: operationsRepository.timelineEvents,
};

async function snapshotLive(companyId = '') {
  const companyFilter = companyId ? { companyId } : {};
  const [users, companies, employees, branches, listings, routes, routeStops, vehicles, schedules, seats, bookings, ticketScans, supportTickets, refunds, rescheduleRequests, timelineEvents] = await Promise.all([
    collections.users.list({}, { limit: 20000 }),
    collections.companies.list(companyId ? { id: companyId } : {}, { limit: 5000 }),
    collections.employees.list(companyFilter, { limit: 20000 }),
    collections.branches.list(companyFilter, { limit: 20000 }),
    collections.listings.list(companyFilter, { limit: 20000 }),
    collections.routes.list(companyFilter, { limit: 20000 }),
    collections.routeStops.list(companyFilter, { limit: 50000 }),
    collections.vehicles.list(companyFilter, { limit: 20000 }),
    collections.schedules.list(companyFilter, { limit: 50000 }),
    collections.seats.list(companyFilter, { limit: 100000 }),
    collections.bookings.list(companyFilter, { limit: 100000 }),
    collections.ticketScans.list(companyFilter, { limit: 100000 }),
    collections.supportTickets.list(companyFilter, { limit: 50000 }),
    collections.refunds.list(companyFilter, { limit: 50000 }),
    collections.rescheduleRequests.list(companyFilter, { limit: 50000 }),
    collections.timelineEvents.list(companyFilter, { limit: 100000 }),
  ]);
  return { users, companies, employees, branches, listings, routes, routeStops, vehicles, schedules, seats, bookings, ticketScans, supportTickets, refunds, rescheduleRequests, timelineEvents };
}

function scheduleForCompany(data, companyId, scheduleId) {
  const schedule = data.schedules.find((item) => item.id === scheduleId && (!companyId || item.companyId === companyId));
  if (!schedule) throw serviceError('Schedule not found for this company');
  return schedule;
}
function companyForSchedule(data, schedule) { return data.companies.find((row) => row.id === schedule.companyId) || {}; }
function listingForSchedule(data, schedule) { return data.listings.find((row) => row.id === schedule.listingId) || {}; }
function routeForSchedule(data, schedule) { return data.routes.find((row) => row.id === schedule.routeId || row.listingId === schedule.listingId) || {}; }
function vehicleForSchedule(data, schedule) { return data.vehicles.find((row) => row.id === schedule.vehicleId) || {}; }
function driverNamesForSchedule(data, schedule = {}) {
  const ids = Array.isArray(schedule.driverIds) ? schedule.driverIds : String(schedule.driverIds || '').split(',').map((id) => id.trim()).filter(Boolean);
  const names = ids.map((id) => {
    const employee = data.employees.find((row) => row.id === id || row.userId === id);
    const user = employee ? data.users.find((row) => row.id === employee.userId) : data.users.find((row) => row.id === id);
    return user?.fullName || employee?.fullName || employee?.roleTitle;
  }).filter(Boolean);
  return names.length ? names.join(', ') : clean(schedule.driverName || 'Driver not set');
}
function stopsForRoute(data, route = {}) {
  const persisted = data.routeStops.filter((stop) => stop.routeId === route.id && stop.status !== 'archived');
  const dedupe = new Map();
  persisted.forEach((stop, index) => {
    const row = {
      name: clean(stop.name || stop.stopName || stop.label), type: clean(stop.stopType || stop.type || 'stop'),
      order: Number(stop.stopOrder || stop.order || index + 1), pickupAllowed: stop.pickupAllowed !== false,
      dropoffAllowed: stop.dropoffAllowed !== false, instructions: clean(stop.publicInstructions || stop.instructions || ''),
    };
    if (row.name) dedupe.set(`${row.order}:${normalize(row.name)}`, row);
  });
  return [...dedupe.values()].sort((a, b) => a.order - b.order);
}
function passengerName(booking = {}, passenger = {}) { return clean(passenger.fullName || passenger.name || booking.guestSnapshot?.fullName || booking.customerName || 'Passenger'); }
function formatSeatNo(value) {
  const raw = clean(value || ''); if (!raw) return 'Selected';
  const withoutPrefix = raw.replace(/^seat\s*(no\.?|number)?\s*/i, '').trim();
  const prefixed = withoutPrefix.match(/^[A-Za-z](\d+)$/); return `Seat No ${prefixed ? prefixed[1] : withoutPrefix || raw}`;
}
function passengerSeatNumber(passenger = {}) { return clean(passenger.seatOrRoom || passenger.seatNumber || passenger.seat || ''); }
function passengerSeat(passenger = {}) { return formatSeatNo(passengerSeatNumber(passenger)); }
function contactFor(booking = {}, passenger = {}) { return clean(passenger.phone || passenger.email || booking.guestSnapshot?.phone || booking.guestSnapshot?.email || booking.phone || booking.email || '-'); }
function bookingTotal(booking = {}) { return money(booking.pricing?.total || booking.total || booking.amount || 0, booking.pricing?.currency || booking.currency || platformCurrency()); }
function checkStatus(booking = {}, passenger = {}) {
  if (passenger.checkInStatus === 'checked_in' || booking.bookingStatus === 'checked_in' || booking.checkInStatus === 'checked_in') return 'Checked in';
  if (passenger.checkInStatus === 'no_show' || booking.bookingStatus === 'no_show' || booking.checkInStatus === 'no_show') return 'No-show';
  if (booking.bookingStatus === 'cancelled') return 'Cancelled';
  if (booking.bookingStatus === 'refunded') return 'Refunded';
  return 'Boarding';
}
function bookingSource(booking = {}) { return clean(booking.bookingChannel || booking.source || booking.bookingSource || booking.channel || (booking.promoterAttribution ? 'promoter' : 'online')); }
function promoterLabel(data, booking = {}) {
  const promoterId = booking.promoterAttribution?.promoterId || ''; if (!promoterId) return '-';
  return data.users.find((user) => user.id === promoterId)?.fullName || promoterId;
}
function ticketForPassenger(booking = {}, scheduleId, passenger = {}) {
  const seatNumber = passengerSeatNumber(passenger);
  return (booking.ticketLegs || []).find((leg) => leg.scheduleId === scheduleId && clean(leg.seatNumber) === seatNumber)
    || (booking.ticketLegs || []).find((leg) => clean(leg.seatNumber) === seatNumber) || (booking.ticketLegs || [])[0] || {};
}
function bookingMatchesSchedule(booking = {}, scheduleId) {
  return booking.scheduleId === scheduleId || (booking.bookingItems || []).some((item) => item.scheduleId === scheduleId)
    || (booking.bookingLegs || []).some((leg) => leg.scheduleId === scheduleId) || (booking.ticketLegs || []).some((leg) => leg.scheduleId === scheduleId);
}
function rowsForSchedule(data, schedule, options = {}) {
  const listing = listingForSchedule(data, schedule); const company = companyForSchedule(data, schedule);
  const route = routeForSchedule(data, schedule); const vehicle = vehicleForSchedule(data, schedule); const routeStops = stopsForRoute(data, route);
  const bookings = data.bookings.filter((booking) => booking.companyId === schedule.companyId && bookingMatchesSchedule(booking, schedule.id))
    .sort((a, b) => String((a.passengers || [])[0]?.seatOrRoom || '').localeCompare(String((b.passengers || [])[0]?.seatOrRoom || ''), undefined, { numeric: true }));
  const passengers = bookings.flatMap((booking) => (booking.passengers?.length ? booking.passengers : [{}]).map((passenger, index) => {
    const ticket = ticketForPassenger(booking, schedule.id, passenger);
    const pickup = clean(passenger.pickupPoint || booking.pickupPoint || route.boardingPoints || routeStops.find((stop) => stop.pickupAllowed)?.name || listing.from || route.origin || '-');
    const dropoff = clean(passenger.dropoffPoint || booking.dropoffPoint || route.dropoffPoints || [...routeStops].reverse().find((stop) => stop.dropoffAllowed)?.name || listing.to || route.destination || '-');
    return {
      bookingRef: booking.bookingRef, ticketNumber: clean(ticket.ticketNumber || `${booking.bookingRef}-${index + 1}`), customerUserId: booking.customerUserId || '',
      passengerName: passengerName(booking, passenger), seat: passengerSeat(passenger), contact: contactFor(booking, passenger),
      email: clean(passenger.email || booking.guestSnapshot?.email || booking.email || ''), phone: clean(passenger.phone || booking.guestSnapshot?.phone || booking.phone || ''),
      pickupPoint: pickup, dropoffPoint: dropoff, notes: clean(passenger.specialNotes || passenger.travelNotes || passenger.notes || booking.notes || ''),
      bookingStatus: booking.bookingStatus || 'confirmed', checkInStatus: checkStatus(booking, passenger), paymentStatus: booking.paymentStatus || 'pending',
      bookingSource: bookingSource(booking), promoter: promoterLabel(data, booking), amount: bookingTotal(booking),
      ticketUrl: `/tickets/${encodeURIComponent(booking.bookingRef)}`, pdfUrl: `/tickets/${encodeURIComponent(booking.bookingRef)}.pdf`, passengerIndex: index + 1,
      booking, schedule, listing, company, route, vehicle,
    };
  }));
  return { bookings, passengers: options.includeAllPassengers ? passengers : passengers.filter((row) => row.schedule.id === schedule.id), listing, company, route, vehicle, routeStops };
}
function buildManifestFromData(data, companyId, scheduleId, options = {}) {
  const schedule = scheduleForCompany(data, companyId, scheduleId);
  const { bookings, passengers, listing, company, route, vehicle, routeStops } = rowsForSchedule(data, schedule, options);
  const seats = data.seats.filter((seat) => seat.scheduleId === schedule.id).map((seat) => {
    const seatLabel = clean(seat.seatNumber || seat.label || seat.id);
    const passengerRow = passengers.find((row) => normalize(row.seat) === normalize(formatSeatNo(seatLabel)) || normalize(row.seat) === normalize(seatLabel));
    return { scheduleId: schedule.id, seat: seatLabel, bookingRef: passengerRow?.bookingRef || '', passengerName: passengerRow?.passengerName || '', contact: passengerRow?.contact || '', status: passengerRow ? normalize(passengerRow.checkInStatus).replace(/\s+/g, '-') : clean(seat.status || 'available'), ticketUrl: passengerRow ? `/driver/tickets/${encodeURIComponent(passengerRow.bookingRef)}` : '', booking: passengerRow?.booking || null, raw: seat };
  });
  const checkedIn = passengers.filter((row) => row.checkInStatus === 'Checked in').length;
  const noShows = passengers.filter((row) => row.checkInStatus === 'No-show').length;
  const cancelled = passengers.filter((row) => ['Cancelled', 'Refunded'].includes(row.checkInStatus)).length;
  return {
    schedule, listing, company, route, vehicle, routeStops, bookings, passengers, seats,
    stats: { passengers: passengers.length, bookings: bookings.length, checkedIn, noShows, boarding: Math.max(0, passengers.length - checkedIn - noShows - cancelled), totalSeats: seats.length || schedule.totalSeats || 0, availableSeats: seats.filter((seat) => ['available', 'open'].includes(normalize(seat.status))).length, bookedSeats: passengers.length },
    generatedAt: new Date().toISOString(), generatedBy: options.generatedBy || 'Classic Trip operator', printMode: options.printMode || 'before_departure',
    title: `${clean(route.origin || listing.from || listing.title || 'Route')} to ${clean(route.destination || listing.to || 'destination')}`,
    departureLabel: asDate(schedule.departAt), driverLabel: driverNamesForSchedule(data, schedule), scheduleStatus: clean(schedule.status || 'scheduled'),
  };
}

function canonicalBusManifestView(manifest, options = {}) {
  const routeSnapshot = manifest.schedule.routeSnapshot || {};
  const originName = routeSnapshot.origin?.name || manifest.route.origin || manifest.listing.from || manifest.listing.title || 'Route';
  const destinationName = routeSnapshot.destination?.name || manifest.route.destination || manifest.listing.to || 'destination';
  const rows = manifest.passengers.map((row) => ({
    bookingRef: row.bookingRef,
    ticketNumber: row.ticketNumber,
    customerUserId: row.booking?.customerUserId || '',
    passengerName: row.passengerName,
    seat: formatSeatNo(row.seatNumber),
    contact: clean(row.phone || row.email || '-'),
    email: clean(row.email),
    phone: clean(row.phone),
    pickupPoint: row.pickupPoint || originName,
    dropoffPoint: row.dropoffPoint || destinationName,
    notes: row.specialNotes || '',
    bookingStatus: row.bookingStatus || row.booking?.bookingStatus || 'confirmed',
    checkInStatus: row.checkInStatus === 'checked_in' ? 'Checked in' : row.checkInStatus === 'no_show' ? 'No-show' : 'Boarding',
    paymentStatus: row.paymentStatus || row.booking?.paymentStatus || 'pending',
    bookingSource: bookingSource(row.booking || {}),
    promoter: '-',
    amount: bookingTotal(row.booking || {}),
    seatNumber: row.seatNumber,
    ticket: row.ticket || {},
    ticketUrl: `/tickets/${encodeURIComponent(row.bookingRef)}`,
    pdfUrl: `/tickets/${encodeURIComponent(row.bookingRef)}.pdf`,
    booking: row.booking || {},
    schedule: manifest.schedule,
    listing: manifest.listing,
    company: { id: manifest.companyId },
    route: manifest.route,
    vehicle: manifest.vehicle,
  }));
  const passengerBySeat = new Map(rows.map((row) => [clean(row.seatNumber || row.ticket?.seatNumber || row.seat).replace(/^Seat No\s*/i, ''), row]));
  const seats = (manifest.seats || []).map((seat) => {
    const seatNumber = clean(seat.seatNumber || seat.label || seat.id);
    const passenger = passengerBySeat.get(seatNumber);
    return {
      scheduleId: manifest.schedule.id,
      seat: seatNumber,
      bookingRef: passenger?.bookingRef || '',
      passengerName: passenger?.passengerName || '',
      contact: passenger?.contact || '',
      status: passenger ? normalize(passenger.checkInStatus).replace(/\s+/g, '-') : clean(seat.status || 'available'),
      ticketUrl: passenger ? `/driver/tickets/${encodeURIComponent(passenger.bookingRef)}` : '',
      booking: passenger?.booking || null,
      raw: seat,
    };
  });
  const checkedIn = rows.filter((row) => row.checkInStatus === 'Checked in').length;
  const noShows = rows.filter((row) => row.checkInStatus === 'No-show').length;
  const driverLabel = (manifest.crew || []).map((row) => row.driverName || row.employeeName || row.employeeId).filter(Boolean).join(', ') || manifest.schedule.driverName || 'Driver not set';
  return {
    ...manifest,
    company: manifest.company || { id: manifest.companyId },
    routeStops: routeSnapshot.stops || [],
    passengers: rows,
    seats,
    stats: {
      passengers: rows.length,
      bookings: new Set(rows.map((row) => row.bookingRef)).size,
      checkedIn,
      noShows,
      boarding: Math.max(0, rows.length - checkedIn - noShows),
      totalSeats: seats.length || manifest.schedule.totalSeats || 0,
      availableSeats: seats.filter((seat) => ['available', 'open'].includes(normalize(seat.status))).length,
      bookedSeats: rows.length,
    },
    generatedAt: manifest.generatedAt || new Date().toISOString(),
    generatedBy: options.generatedBy || 'Classic Trip operator',
    printMode: options.printMode || 'before_departure',
    title: `${originName} to ${destinationName}`,
    departureLabel: asDate(manifest.schedule.departAt),
    driverLabel,
    scheduleStatus: clean(manifest.schedule.status || 'scheduled'),
  };
}

async function buildManifestLive(companyId, scheduleId, options = {}) {
  const data = await snapshotLive(companyId);
  const schedule = scheduleForCompany(data, companyId, scheduleId);
  const listing = listingForSchedule(data, schedule);
  if (normalize(listing.serviceType || schedule.serviceType) === 'bus') {
    const busOperationsService = require('../../modules/bus/services/busOperationsService');
    return canonicalBusManifestView(await busOperationsService.manifest(companyId, scheduleId), options);
  }
  return buildManifestFromData(data, companyId, scheduleId, options);
}

function bookingDetail(data, booking, listing, company) {
  return {
    booking: { bookingRef: booking.bookingRef, status: booking.bookingStatus, serviceType: booking.serviceType, createdAt: booking.createdAt },
    customer: { userId: booking.customerUserId || '', name: booking.guestSnapshot?.fullName || booking.customerName || '', email: booking.guestSnapshot?.email || booking.email || '', phone: booking.guestSnapshot?.phone || booking.phone || '' },
    company: { id: company.id || booking.companyId, name: company.name || booking.companyName || '' },
    listing: { id: listing.id || booking.listingId, title: listing.title || booking.listingTitle || '' },
    payment: { amount: booking.pricing?.total || booking.total || 0, currency: booking.pricing?.currency || booking.currency || platformCurrency(), status: booking.paymentStatus || 'pending' },
  };
}
function bookingForCompanyFromData(data, companyId, bookingRef) {
  const booking = data.bookings.find((row) => row.bookingRef === bookingRef && (!companyId || row.companyId === companyId));
  if (!booking) throw serviceError('Ticket not found for this company');
  const schedule = booking.scheduleId ? scheduleForCompany(data, companyId || booking.companyId, booking.scheduleId) : null;
  const listing = data.listings.find((row) => row.id === booking.listingId) || {}; const company = data.companies.find((row) => row.id === booking.companyId) || {};
  const route = schedule ? routeForSchedule(data, schedule) : {}; const passenger = (booking.passengers || [])[0] || {};
  const ticket = schedule ? ticketForPassenger(booking, schedule.id, passenger) : (booking.ticketLegs || [])[0] || {};
  const scanHistory = data.ticketScans.filter((scan) => scan.bookingRef === booking.bookingRef || (ticket.ticketNumber && scan.ticketNumber === ticket.ticketNumber));
  const supportMessages = data.supportTickets.filter((item) => item.bookingRef === booking.bookingRef);
  const timeline = data.timelineEvents.filter((event) => event.bookingRef === booking.bookingRef).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const refund = data.refunds.find((item) => item.bookingRef === booking.bookingRef) || {}; const reschedule = data.rescheduleRequests.find((item) => item.bookingRef === booking.bookingRef) || {};
  return {
    booking, schedule, listing, company, route, passenger, ticket, scanHistory, supportMessages, timeline, refund, reschedule,
    detail: bookingDetail(data, booking, listing, company),
    printable: { passengerName: passengerName(booking, passenger), ticketNumber: ticket.ticketNumber || booking.bookingRef, seat: passengerSeat(passenger), pickupPoint: clean(passenger.pickupPoint || booking.pickupPoint || route.boardingPoints || '-'), dropoffPoint: clean(passenger.dropoffPoint || booking.dropoffPoint || route.dropoffPoints || '-'), notes: clean(passenger.specialNotes || passenger.notes || booking.notes || ''), contact: contactFor(booking, passenger), amount: bookingTotal(booking), status: ticket.checkInStatus || checkStatus(booking, passenger), qrTokenPreview: ticket.qrTokenPreview || '', scanCount: ticket.scanCount || scanHistory.length || 0, refundStatus: refund.status || booking.refundStatus || '', rescheduleStatus: reschedule.status || '', paymentStatus: booking.paymentStatus || 'pending', departureLabel: schedule ? asDate(schedule.departAt) : '-' },
  };
}
async function bookingForCompanyLive(companyId, bookingRef) {
  const result = bookingForCompanyFromData(await snapshotLive(companyId), companyId, bookingRef);
  result.timeline = await timelineService.bookingTimeline(result.booking.bookingRef, { includeInternal: true });
  return result;
}
function bookingForSeatFromData(data, companyId, scheduleId, seatNumber) {
  const schedule = scheduleForCompany(data, companyId, scheduleId); const requestedSeat = clean(seatNumber); const requestedLabel = formatSeatNo(requestedSeat);
  const booking = data.bookings.find((item) => item.companyId === companyId && bookingMatchesSchedule(item, schedule.id) && (item.passengers || []).some((pax) => {
    const values = [pax.seatOrRoom, pax.seatNumber, pax.seat, passengerSeat(pax), formatSeatNo(pax.seatOrRoom || pax.seatNumber || pax.seat || '')].map(clean);
    return values.includes(requestedSeat) || values.includes(requestedLabel);
  }));
  if (!booking) throw serviceError('No booked ticket found for this seat');
  return bookingForCompanyFromData(data, companyId, booking.bookingRef);
}
async function bookingForSeatLive(companyId, scheduleId, seatNumber) { return bookingForSeatFromData(await snapshotLive(companyId), companyId, scheduleId, seatNumber); }
function matchesFilter(text, expected) { return !expected || normalize(text).includes(normalize(expected)); }
function buildCustomerListFromData(data, companyId, filters = {}) {
  const rows = [];
  data.schedules.filter((schedule) => !companyId || schedule.companyId === companyId).forEach((schedule) => {
    const manifest = buildManifestFromData(data, companyId, schedule.id, { generatedBy: filters.generatedBy });
    manifest.passengers.forEach((row) => rows.push({
      ...row,
      scheduleId: schedule.id,
      scheduleStatus: schedule.status || '',
      departureDate: dateKey(schedule.departAt),
      departureLabel: asDate(schedule.departAt),
      routeLabel: `${manifest.route.origin || manifest.listing.from || '-'} to ${manifest.route.destination || manifest.listing.to || '-'}`,
      vehicleLabel: manifest.vehicle.name || manifest.vehicle.plateOrCode || schedule.vehicleName || '',
      driverLabel: manifest.driverLabel,
      driverIds: [schedule.driverEmployeeId, schedule.driverUserId, ...(schedule.driverIds || [])].filter(Boolean),
      terminalIds: [manifest.route.originTerminalId, manifest.route.destinationTerminalId, ...(manifest.route.boardingBranchIds || []), ...(manifest.route.dropoffBranchIds || [])].filter(Boolean),
      terminalLabel: [manifest.route.originTerminalId, manifest.route.destinationTerminalId, manifest.route.boardingPoints, manifest.route.dropoffPoints].filter(Boolean).join(' '),
      promoterId: row.booking?.promoterAttribution?.promoterId || '',
      companyName: manifest.company.name || '',
    }));
  });
  return rows.filter((row) => {
    if (filters.scheduleId && row.scheduleId !== filters.scheduleId) return false;
    if (filters.routeId && row.schedule.routeId !== filters.routeId) return false;
    if (filters.vehicleId && row.schedule.vehicleId !== filters.vehicleId) return false;
    if (filters.driver && !(row.driverIds || []).includes(filters.driver) && !matchesFilter(row.driverLabel, filters.driver)) return false;
    if (filters.company && !matchesFilter(row.companyName, filters.company)) return false;
    if (filters.terminal && !(row.terminalIds || []).includes(filters.terminal) && !matchesFilter(`${row.terminalLabel} ${row.pickupPoint} ${row.dropoffPoint}`, filters.terminal)) return false;
    if (filters.date && row.departureDate !== filters.date) return false;
    if (filters.ticketStatus && !matchesFilter(row.bookingStatus, filters.ticketStatus)) return false;
    if (filters.checkInStatus && !matchesFilter(row.checkInStatus, filters.checkInStatus)) return false;
    if (filters.paymentStatus && !matchesFilter(row.paymentStatus, filters.paymentStatus)) return false;
    if (filters.promoter && row.promoterId !== filters.promoter && !matchesFilter(row.promoter, filters.promoter)) return false;
    if (filters.bookingSource && !matchesFilter(row.bookingSource, filters.bookingSource)) return false;
    return true;
  });
}
async function buildCustomerListLive(companyId, filters = {}) { return buildCustomerListFromData(await snapshotLive(companyId), companyId, filters); }

async function customerManifestFilterOptionsLive(companyId) {
  const data = await snapshotLive(companyId);
  const active = (status) => !['archived', 'rejected', 'revoked'].includes(normalize(status));
  const unique = (rows, key) => Array.from(new Map(rows.filter(Boolean).map((row) => [row[key], row])).values());
  const drivers = data.employees.filter((employee) => {
    const account = data.users.find((row) => row.id === employee.userId) || {};
    return active(employee.status) && evaluateDriverEligibility(employee, account).eligible;
  }).map((employee) => {
    const user = data.users.find((row) => row.id === employee.userId) || {};
    return { value: employee.id, label: user.fullName || user.email || employee.id };
  });
  const promoterIds = data.bookings.map((booking) => booking.promoterAttribution?.promoterId).filter(Boolean);
  return {
    schedules: data.schedules.filter((row) => active(row.status)).map((row) => ({ value: row.id, label: `${asDate(row.departAt)} - ${row.id}` })),
    routes: data.routes.filter((row) => active(row.status)).map((row) => ({ value: row.id, label: row.routeName || `${row.origin || ''} to ${row.destination || ''}` })),
    vehicles: data.vehicles.filter((row) => active(row.status)).map((row) => ({ value: row.id, label: `${row.name || row.id}${row.plateOrCode ? ` - ${row.plateOrCode}` : ''}` })),
    drivers,
    branches: data.branches.filter((row) => active(row.status)).map((row) => ({ value: row.id, label: `${row.name}${row.city ? ` - ${row.city}` : ''}` })),
    promoters: unique(promoterIds.map((id) => ({ value: id, label: data.users.find((row) => row.id === id)?.fullName || id })), 'value'),
    bookingSources: [...new Set(data.bookings.map((booking) => bookingSource(booking)).filter(Boolean))].sort(),
  };
}

const MANIFEST_HEADERS = ['Booking', 'Passenger', 'Seat', 'Contact', 'Ticket', 'Pickup', 'Dropoff', 'Payment', 'Check-in', 'Booking status', 'Source', 'Promoter', 'Notes', 'Passenger signature', 'Driver signature'];
function rowsForExport(passengers = []) { return passengers.map((row) => [row.bookingRef, row.passengerName, row.seat, row.contact, row.ticketNumber, row.pickupPoint, row.dropoffPoint, row.paymentStatus, row.checkInStatus, row.bookingStatus, row.bookingSource, row.promoter, row.notes, '', '']); }
function neutralizeFormula(text) { return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text; }
function escapeCsv(value) { const text = neutralizeFormula(String(value ?? '')); return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
function toCsv(headers, rows) { return [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n'); }
function escapeXml(value) { return String(neutralizeFormula(String(value ?? ''))).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function toExcelXml(headers, rows, worksheetName = 'Manifest') {
  const allRows = [headers, ...rows].map((row) => `<Row>${row.map((cell) => `<Cell><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>`).join('')}</Row>`).join('');
  return `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="${escapeXml(worksheetName).slice(0, 31) || 'Manifest'}"><Table>${allRows}</Table></Worksheet></Workbook>`;
}
function manifestCsv(companyId, scheduleId) { const manifest = buildManifest(companyId, scheduleId); return { filename: `${scheduleId}-manifest.csv`, csv: toCsv(MANIFEST_HEADERS, rowsForExport(manifest.passengers)) }; }
async function manifestCsvLive(companyId, scheduleId) { const manifest = await buildManifestLive(companyId, scheduleId); return { filename: `${scheduleId}-manifest.csv`, csv: toCsv(MANIFEST_HEADERS, rowsForExport(manifest.passengers)) }; }
function manifestExcel(companyId, scheduleId) { const manifest = buildManifest(companyId, scheduleId); return { filename: `${scheduleId}-manifest.xls`, contentType: 'application/vnd.ms-excel; charset=utf-8', body: toExcelXml(MANIFEST_HEADERS, rowsForExport(manifest.passengers), 'Schedule Manifest') }; }
async function manifestExcelLive(companyId, scheduleId) { const manifest = await buildManifestLive(companyId, scheduleId); return { filename: `${scheduleId}-manifest.xls`, contentType: 'application/vnd.ms-excel; charset=utf-8', body: toExcelXml(MANIFEST_HEADERS, rowsForExport(manifest.passengers), 'Schedule Manifest') }; }
function customerExport(rows) { return rows.map((row) => [row.scheduleId, row.departureLabel, row.routeLabel, row.vehicleLabel, row.driverLabel, ...rowsForExport([row])[0]]); }
function filteredCustomerCsv(companyId, filters = {}) { const rows = buildCustomerList(companyId, filters); return { filename: `company-customer-manifest-${new Date().toISOString().slice(0, 10)}.csv`, csv: toCsv(['Schedule', 'Departure', 'Route', 'Vehicle', 'Driver', ...MANIFEST_HEADERS], customerExport(rows)) }; }
async function filteredCustomerCsvLive(companyId, filters = {}) { const rows = await buildCustomerListLive(companyId, filters); return { filename: `company-customer-manifest-${new Date().toISOString().slice(0, 10)}.csv`, csv: toCsv(['Schedule', 'Departure', 'Route', 'Vehicle', 'Driver', ...MANIFEST_HEADERS], customerExport(rows)) }; }
function filteredCustomerExcel(companyId, filters = {}) { const rows = buildCustomerList(companyId, filters); return { filename: `company-customer-manifest-${new Date().toISOString().slice(0, 10)}.xls`, contentType: 'application/vnd.ms-excel; charset=utf-8', body: toExcelXml(['Schedule', 'Departure', 'Route', 'Vehicle', 'Driver', ...MANIFEST_HEADERS], customerExport(rows), 'Customer Manifest') }; }
async function filteredCustomerExcelLive(companyId, filters = {}) { const rows = await buildCustomerListLive(companyId, filters); return { filename: `company-customer-manifest-${new Date().toISOString().slice(0, 10)}.xls`, contentType: 'application/vnd.ms-excel; charset=utf-8', body: toExcelXml(['Schedule', 'Departure', 'Route', 'Vehicle', 'Driver', ...MANIFEST_HEADERS], customerExport(rows), 'Customer Manifest') }; }
async function manifestPdfBuffer(companyId, scheduleId, options = {}) {
  const manifest = await buildManifestLive(companyId, scheduleId, options);
  return pdfBufferForRows({ title: 'Classic Trip Manifest', subtitle: `${manifest.company.name || 'Company'} • ${manifest.schedule.id}`, context: [manifest.title, `Departure: ${manifest.departureLabel}`, `Vehicle: ${manifest.vehicle.name || manifest.schedule.vehicleName || '-'} • Driver: ${manifest.driverLabel}`, `Passengers: ${manifest.stats.passengers} • Checked in: ${manifest.stats.checkedIn} • No-show: ${manifest.stats.noShows}`], rows: manifest.passengers, footer: `Generated by ${manifest.generatedBy} at ${asDate(manifest.generatedAt)}. Passenger and driver signatures are required where company policy needs signed manifests.` });
}
async function filteredCustomerPdfBuffer(companyId, filters = {}) {
  const rows = await buildCustomerListLive(companyId, filters);
  return pdfBufferForRows({ title: 'Classic Trip Customer Manifest', subtitle: `Company ${companyId || 'all companies'} • ${rows.length} passenger row(s)`, context: [`Filters: ${Object.entries(filters).filter(([, value]) => value).map(([key, value]) => `${key}=${value}`).join(', ') || 'none'}`], rows, footer: `Generated ${asDate(new Date().toISOString())}. Export is filterable by route, schedule, vehicle, driver, company, terminal, date, ticket status, check-in status, payment status, promoter, and booking source.` });
}
async function pdfBufferForRows({ title, subtitle, context = [], rows = [], footer = '' }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 36, info: { Title: title } }); const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
      doc.rect(0, 0, 595, 96).fill('#111827'); doc.fillColor('#ffffff').fontSize(21).text(title, 36, 28); doc.fontSize(10).fillColor('#cbd5e1').text(subtitle, 36, 58);
      let y = 118; context.forEach((line) => { doc.fontSize(10).fillColor('#475569').text(line, 36, y); y += 16; }); y += 14;
      doc.fontSize(8).fillColor('#64748b'); ['Booking', 'Ticket', 'Passenger', 'Seat', 'Pickup', 'Dropoff', 'Status'].forEach((header, index) => doc.text(header, [36, 92, 158, 272, 316, 386, 466][index], y, { width: [52, 62, 108, 38, 66, 74, 74][index] }));
      y += 18; doc.moveTo(36, y - 6).lineTo(558, y - 6).strokeColor('#e5e7eb').stroke();
      rows.forEach((row) => { if (y > 748) { doc.addPage(); y = 46; } doc.fontSize(7.5).fillColor('#111827'); doc.text(row.bookingRef, 36, y, { width: 52 }); doc.text(row.ticketNumber, 92, y, { width: 62 }); doc.text(row.passengerName, 158, y, { width: 108 }); doc.text(row.seat, 272, y, { width: 38 }); doc.text(row.pickupPoint, 316, y, { width: 66 }); doc.text(row.dropoffPoint, 386, y, { width: 74 }); doc.text(row.checkInStatus, 466, y, { width: 74 }); y += 21; });
      y += 18; if (y < 730) doc.fontSize(8).fillColor('#64748b').text('Passenger signature: ____________________________   Driver signature: ____________________________', 36, y, { width: 520 });
      doc.fontSize(8).fillColor('#64748b').text(footer, 36, 790, { width: 520 }); doc.end();
    } catch (error) { reject(error); }
  });
}

module.exports = {
  buildManifest: buildManifestLive, buildManifestLive, buildCustomerList: buildCustomerListLive, buildCustomerListLive, customerManifestFilterOptionsLive,
  bookingForCompany: bookingForCompanyLive, bookingForCompanyLive, bookingForSeat: bookingForSeatLive, bookingForSeatLive,
  manifestCsv, manifestCsvLive, manifestExcel, manifestExcelLive,
  filteredCustomerCsv, filteredCustomerCsvLive, filteredCustomerExcel, filteredCustomerExcelLive,
  manifestPdfBuffer, filteredCustomerPdfBuffer,
};

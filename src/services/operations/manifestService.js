const PDFDocument = require('pdfkit');
const store = require('../data/persistentStore');
const timelineService = require('../support/timelineService');

function clean(value, fallback = '') {
  return String(value ?? fallback).replace(/<[^>]*>/g, '').trim();
}

function normalize(value) {
  return clean(value).toLowerCase();
}

function money(amount, currency = 'UGX') {
  return `${currency} ${Math.round(Number(amount) || 0).toLocaleString()}`;
}

function asDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clean(value);
  return date.toLocaleString('en-UG', { dateStyle: 'medium', timeStyle: 'short' });
}

function dateKey(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : '';
}

function error(message, status = 404) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function findScheduleForCompany(companyId, scheduleId) {
  const schedule = store.state.schedules.find((item) => item.id === scheduleId && (!companyId || item.companyId === companyId));
  if (!schedule) throw error('Schedule not found for this company', 404);
  return schedule;
}

function companyForSchedule(schedule) {
  return store.findCompany(schedule.companyId) || {};
}

function listingForSchedule(schedule) {
  return store.findListing(schedule.listingId) || {};
}

function routeForSchedule(schedule) {
  return store.state.routes.find((route) => route.id === schedule.routeId || route.listingId === schedule.listingId) || {};
}

function vehicleForSchedule(schedule) {
  return store.state.vehicles.find((vehicle) => vehicle.id === schedule.vehicleId) || {};
}

function driverNamesForSchedule(schedule = {}) {
  const ids = Array.isArray(schedule.driverIds) ? schedule.driverIds : String(schedule.driverIds || '').split(',').map((id) => id.trim()).filter(Boolean);
  const names = ids.map((id) => store.state.companyEmployees.find((employee) => employee.id === id || employee.userId === id)?.fullName).filter(Boolean);
  return names.length ? names.join(', ') : clean(schedule.driverName || 'Driver not set');
}

function stopsForRoute(route = {}) {
  const routeStops = (store.state.routeStops || []).filter((stop) => stop.routeId === route.id && stop.status !== 'archived');
  const inlineStops = Array.isArray(route.stops) ? route.stops : [];
  return [...routeStops, ...inlineStops]
    .map((stop, index) => ({
      name: clean(stop.name || stop.stopName || stop.label),
      type: clean(stop.stopType || stop.type || 'stop'),
      order: Number(stop.stopOrder || stop.order || index + 1),
      pickupAllowed: stop.pickupAllowed !== false,
      dropoffAllowed: stop.dropoffAllowed !== false,
      instructions: clean(stop.publicInstructions || stop.instructions || ''),
    }))
    .filter((stop) => stop.name)
    .sort((a, b) => a.order - b.order);
}

function passengerName(booking = {}, passenger = {}) {
  return clean(passenger.fullName || passenger.name || booking.guestSnapshot?.fullName || booking.customerName || 'Passenger');
}

function formatSeatNo(value) {
  const raw = clean(value || '');
  if (!raw) return 'Selected';
  const withoutPrefix = raw.replace(/^seat\s*(no\.?|number)?\s*/i, '').trim();
  const legacy = withoutPrefix.match(/^[A-Za-z](\d+)$/);
  const cleanNumber = legacy ? legacy[1] : withoutPrefix;
  return `Seat No ${cleanNumber || raw}`;
}

function passengerSeat(passenger = {}) {
  return formatSeatNo(passenger.seatOrRoom || passenger.seatNumber || passenger.seat || '');
}

function contactFor(booking = {}, passenger = {}) {
  return clean(passenger.phone || passenger.email || booking.guestSnapshot?.phone || booking.guestSnapshot?.email || booking.phone || booking.email || '-');
}

function bookingTotal(booking = {}) {
  return money(booking.pricing?.total || booking.total || booking.amount || 0, booking.pricing?.currency || booking.currency || 'UGX');
}

function checkStatus(booking = {}, passenger = {}) {
  if (passenger.checkInStatus === 'checked_in' || booking.bookingStatus === 'checked_in' || booking.checkInStatus === 'checked_in') return 'Checked in';
  if (passenger.checkInStatus === 'no_show' || booking.bookingStatus === 'no_show' || booking.checkInStatus === 'no_show') return 'No-show';
  if (booking.bookingStatus === 'cancelled') return 'Cancelled';
  if (booking.bookingStatus === 'refunded') return 'Refunded';
  return 'Boarding';
}

function bookingSource(booking = {}) {
  return clean(booking.bookingChannel || booking.source || booking.bookingSource || booking.channel || (booking.promoterAttribution ? 'promoter' : 'online'));
}

function promoterLabel(booking = {}) {
  const promoterId = booking.promoterAttribution?.promoterId || '';
  if (!promoterId) return '-';
  return store.state.users.find((user) => user.id === promoterId)?.fullName || promoterId;
}

function ticketForPassenger(booking = {}, scheduleId, passenger = {}) {
  const seat = passengerSeat(passenger);
  const ticket = (booking.ticketLegs || []).find((leg) => leg.scheduleId === scheduleId && clean(leg.seatNumber) === seat)
    || (booking.ticketLegs || []).find((leg) => clean(leg.seatNumber) === seat)
    || (booking.ticketLegs || [])[0]
    || {};
  return ticket;
}

function bookingMatchesSchedule(booking = {}, scheduleId) {
  if (booking.scheduleId === scheduleId) return true;
  return (booking.bookingItems || []).some((item) => item.scheduleId === scheduleId)
    || (booking.bookingLegs || []).some((leg) => leg.scheduleId === scheduleId)
    || (booking.ticketLegs || []).some((leg) => leg.scheduleId === scheduleId);
}

function rowsForSchedule(schedule, options = {}) {
  const listing = listingForSchedule(schedule);
  const company = companyForSchedule(schedule);
  const route = routeForSchedule(schedule);
  const vehicle = vehicleForSchedule(schedule);
  const routeStops = stopsForRoute(route);
  const bookings = store.state.bookings
    .filter((booking) => bookingMatchesSchedule(booking, schedule.id) && booking.companyId === schedule.companyId)
    .sort((a, b) => String((a.passengers || [])[0]?.seatOrRoom || '').localeCompare(String((b.passengers || [])[0]?.seatOrRoom || ''), undefined, { numeric: true }));

  const passengers = bookings.flatMap((booking) => {
    const paxRows = (booking.passengers && booking.passengers.length ? booking.passengers : [{}]);
    return paxRows.map((passenger, index) => {
      const ticket = ticketForPassenger(booking, schedule.id, passenger);
      const pickup = clean(passenger.pickupPoint || booking.pickupPoint || route.boardingPoints || routeStops.find((stop) => stop.pickupAllowed)?.name || listing.from || route.origin || '-');
      const dropoff = clean(passenger.dropoffPoint || booking.dropoffPoint || route.dropoffPoints || [...routeStops].reverse().find((stop) => stop.dropoffAllowed)?.name || listing.to || route.destination || '-');
      return {
        bookingRef: booking.bookingRef,
        ticketNumber: clean(ticket.ticketNumber || `${booking.bookingRef}-${index + 1}`),
        customerUserId: booking.customerUserId || '',
        passengerName: passengerName(booking, passenger),
        seat: passengerSeat(passenger),
        contact: contactFor(booking, passenger),
        email: clean(passenger.email || booking.guestSnapshot?.email || booking.email || ''),
        phone: clean(passenger.phone || booking.guestSnapshot?.phone || booking.phone || ''),
        pickupPoint: pickup,
        dropoffPoint: dropoff,
        notes: clean(passenger.specialNotes || passenger.travelNotes || passenger.notes || booking.notes || ''),
        bookingStatus: booking.bookingStatus || 'confirmed',
        checkInStatus: checkStatus(booking, passenger),
        paymentStatus: booking.paymentStatus || 'pending',
        bookingSource: bookingSource(booking),
        promoter: promoterLabel(booking),
        amount: bookingTotal(booking),
        ticketUrl: `/tickets/${encodeURIComponent(booking.bookingRef)}`,
        pdfUrl: `/tickets/${encodeURIComponent(booking.bookingRef)}.pdf`,
        passengerIndex: index + 1,
        booking,
        schedule,
        listing,
        company,
        route,
        vehicle,
      };
    });
  });

  const filtered = options.includeAllPassengers ? passengers : passengers.filter((row) => row.schedule.id === schedule.id);
  return { bookings, passengers: filtered, listing, company, route, vehicle, routeStops };
}

function buildManifest(companyId, scheduleId, options = {}) {
  const schedule = findScheduleForCompany(companyId, scheduleId);
  const { bookings, passengers, listing, company, route, vehicle, routeStops } = rowsForSchedule(schedule, options);

  const seats = store.seatsForSchedule(schedule.id).map((seat) => {
    const seatLabel = clean(seat.seatNumber || seat.label || seat.id);
    const passengerRow = passengers.find((row) => row.seat === seatLabel);
    const status = passengerRow ? normalize(passengerRow.checkInStatus).replace(/\s+/g, '-') : clean(seat.status || 'available');
    return {
      scheduleId: schedule.id,
      seat: seatLabel,
      bookingRef: passengerRow?.bookingRef || '',
      passengerName: passengerRow?.passengerName || '',
      contact: passengerRow?.contact || '',
      status,
      ticketUrl: passengerRow ? `/driver/tickets/${encodeURIComponent(passengerRow.bookingRef)}` : '',
      booking: passengerRow?.booking || null,
      raw: seat,
    };
  });

  const checkedIn = passengers.filter((row) => row.checkInStatus === 'Checked in').length;
  const noShows = passengers.filter((row) => row.checkInStatus === 'No-show').length;
  const cancelled = passengers.filter((row) => ['Cancelled', 'Refunded'].includes(row.checkInStatus)).length;
  const stats = {
    passengers: passengers.length,
    bookings: bookings.length,
    checkedIn,
    noShows,
    boarding: Math.max(0, passengers.length - checkedIn - noShows - cancelled),
    totalSeats: seats.length || schedule.totalSeats || 0,
    availableSeats: seats.filter((seat) => ['available', 'open'].includes(normalize(seat.status))).length,
    bookedSeats: passengers.length,
  };

  return {
    schedule,
    listing,
    company,
    route,
    vehicle,
    routeStops,
    bookings,
    passengers,
    seats,
    stats,
    generatedAt: new Date().toISOString(),
    generatedBy: options.generatedBy || 'Classic Trip operator',
    printMode: options.printMode || 'before_departure',
    title: `${clean(route.origin || listing.from || listing.title || 'Route')} to ${clean(route.destination || listing.to || 'destination')}`,
    departureLabel: asDate(schedule.departAt),
    driverLabel: driverNamesForSchedule(schedule),
    scheduleStatus: clean(schedule.status || 'scheduled'),
  };
}

function bookingForCompany(companyId, bookingRef) {
  const booking = store.findBooking(bookingRef);
  if (!booking || (companyId && booking.companyId !== companyId)) throw error('Ticket not found for this company', 404);
  const schedule = booking.scheduleId ? findScheduleForCompany(companyId || booking.companyId, booking.scheduleId) : null;
  const listing = store.findListing(booking.listingId) || {};
  const company = store.findCompany(booking.companyId) || {};
  const route = schedule ? routeForSchedule(schedule) : {};
  const passenger = (booking.passengers || [])[0] || {};
  const ticket = schedule ? ticketForPassenger(booking, schedule.id, passenger) : (booking.ticketLegs || [])[0] || {};
  const scanHistory = (store.state.ticketScans || []).filter((scan) => scan.bookingRef === booking.bookingRef || (ticket.ticketNumber && scan.ticketNumber === ticket.ticketNumber));
  const supportMessages = (store.state.supportTickets || []).filter((item) => item.bookingRef === booking.bookingRef);
  const timeline = timelineService.bookingTimeline(booking.bookingRef, { includeInternal: true });
  const refund = (store.state.refundRequests || []).find((item) => item.bookingRef === booking.bookingRef) || {};
  const reschedule = (store.state.rescheduleRequests || []).find((item) => item.bookingRef === booking.bookingRef) || {};
  return {
    booking,
    schedule,
    listing,
    company,
    route,
    passenger,
    ticket,
    scanHistory,
    supportMessages,
    timeline,
    refund,
    reschedule,
    detail: store.bookingDetail(booking),
    printable: {
      passengerName: passengerName(booking, passenger),
      ticketNumber: ticket.ticketNumber || booking.bookingRef,
      seat: passengerSeat(passenger),
      pickupPoint: clean(passenger.pickupPoint || booking.pickupPoint || route.boardingPoints || '-'),
      dropoffPoint: clean(passenger.dropoffPoint || booking.dropoffPoint || route.dropoffPoints || '-'),
      notes: clean(passenger.specialNotes || passenger.notes || booking.notes || ''),
      contact: contactFor(booking, passenger),
      amount: bookingTotal(booking),
      status: ticket.checkInStatus || checkStatus(booking, passenger),
      qrTokenPreview: ticket.qrTokenPreview || '',
      scanCount: ticket.scanCount || scanHistory.length || 0,
      refundStatus: refund.status || booking.refundStatus || '',
      rescheduleStatus: reschedule.status || '',
      paymentStatus: booking.paymentStatus || 'pending',
      departureLabel: schedule ? asDate(schedule.departAt) : '-',
    },
  };
}

function bookingForSeat(companyId, scheduleId, seatNumber) {
  const schedule = findScheduleForCompany(companyId, scheduleId);
  const booking = store.state.bookings.find((item) => item.companyId === companyId && bookingMatchesSchedule(item, schedule.id) && (item.passengers || []).some((pax) => passengerSeat(pax) === seatNumber));
  if (!booking) throw error('No booked ticket found for this seat', 404);
  return bookingForCompany(companyId, booking.bookingRef);
}

function matchesFilter(text, expected) {
  if (!expected) return true;
  return normalize(text).includes(normalize(expected));
}

function buildCustomerList(companyId, filters = {}) {
  const schedules = store.state.schedules.filter((schedule) => !companyId || schedule.companyId === companyId);
  const rows = [];
  schedules.forEach((schedule) => {
    const manifest = buildManifest(companyId, schedule.id, { generatedBy: filters.generatedBy });
    manifest.passengers.forEach((row) => rows.push({
      ...row,
      scheduleId: schedule.id,
      scheduleStatus: schedule.status || '',
      departureDate: dateKey(schedule.departAt),
      departureLabel: asDate(schedule.departAt),
      routeLabel: `${manifest.route.origin || manifest.listing.from || '-'} to ${manifest.route.destination || manifest.listing.to || '-'}`,
      vehicleLabel: manifest.vehicle.name || manifest.vehicle.plateOrCode || schedule.vehicleName || '',
      driverLabel: manifest.driverLabel,
      terminalLabel: [manifest.route.originTerminalId, manifest.route.destinationTerminalId, manifest.route.boardingPoints, manifest.route.dropoffPoints].filter(Boolean).join(' '),
      companyName: manifest.company.name || '',
    }));
  });

  return rows.filter((row) => {
    if (filters.scheduleId && row.scheduleId !== filters.scheduleId) return false;
    if (filters.routeId && row.schedule.routeId !== filters.routeId) return false;
    if (filters.vehicleId && row.schedule.vehicleId !== filters.vehicleId) return false;
    if (filters.driver && !matchesFilter(row.driverLabel, filters.driver)) return false;
    if (filters.company && !matchesFilter(row.companyName, filters.company)) return false;
    if (filters.terminal && !matchesFilter(`${row.terminalLabel} ${row.pickupPoint} ${row.dropoffPoint}`, filters.terminal)) return false;
    if (filters.date && row.departureDate !== filters.date) return false;
    if (filters.ticketStatus && !matchesFilter(row.bookingStatus, filters.ticketStatus)) return false;
    if (filters.checkInStatus && !matchesFilter(row.checkInStatus, filters.checkInStatus)) return false;
    if (filters.paymentStatus && !matchesFilter(row.paymentStatus, filters.paymentStatus)) return false;
    if (filters.promoter && !matchesFilter(row.promoter, filters.promoter)) return false;
    if (filters.bookingSource && !matchesFilter(row.bookingSource, filters.bookingSource)) return false;
    return true;
  });
}

const MANIFEST_HEADERS = ['Booking', 'Passenger', 'Seat', 'Contact', 'Ticket', 'Pickup', 'Dropoff', 'Payment', 'Check-in', 'Booking status', 'Source', 'Promoter', 'Notes', 'Passenger signature', 'Driver signature'];

function rowsForExport(passengers = []) {
  return passengers.map((row) => [
    row.bookingRef,
    row.passengerName,
    row.seat,
    row.contact,
    row.ticketNumber,
    row.pickupPoint,
    row.dropoffPoint,
    row.paymentStatus,
    row.checkInStatus,
    row.bookingStatus,
    row.bookingSource,
    row.promoter,
    row.notes,
    '',
    '',
  ]);
}

function escapeCsv(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(headers, rows) {
  return [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');
}

function escapeXml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toExcelXml(headers, rows, worksheetName = 'Manifest') {
  const allRows = [headers, ...rows].map((row) => `<Row>${row.map((cell) => `<Cell><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>`).join('')}</Row>`).join('');
  return `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="${escapeXml(worksheetName).slice(0, 31) || 'Manifest'}"><Table>${allRows}</Table></Worksheet></Workbook>`;
}

function manifestCsv(companyId, scheduleId) {
  const manifest = buildManifest(companyId, scheduleId);
  return {
    filename: `${scheduleId}-manifest.csv`,
    csv: toCsv(MANIFEST_HEADERS, rowsForExport(manifest.passengers)),
  };
}

function manifestExcel(companyId, scheduleId) {
  const manifest = buildManifest(companyId, scheduleId);
  return {
    filename: `${scheduleId}-manifest.xls`,
    contentType: 'application/vnd.ms-excel; charset=utf-8',
    body: toExcelXml(MANIFEST_HEADERS, rowsForExport(manifest.passengers), 'Schedule Manifest'),
  };
}

function filteredCustomerCsv(companyId, filters = {}) {
  const rows = buildCustomerList(companyId, filters);
  return {
    filename: `company-customer-manifest-${new Date().toISOString().slice(0, 10)}.csv`,
    csv: toCsv(['Schedule', 'Departure', 'Route', 'Vehicle', 'Driver', ...MANIFEST_HEADERS], rows.map((row) => [row.scheduleId, row.departureLabel, row.routeLabel, row.vehicleLabel, row.driverLabel, ...rowsForExport([row])[0]])),
  };
}

function filteredCustomerExcel(companyId, filters = {}) {
  const rows = buildCustomerList(companyId, filters);
  const headers = ['Schedule', 'Departure', 'Route', 'Vehicle', 'Driver', ...MANIFEST_HEADERS];
  const bodyRows = rows.map((row) => [row.scheduleId, row.departureLabel, row.routeLabel, row.vehicleLabel, row.driverLabel, ...rowsForExport([row])[0]]);
  return {
    filename: `company-customer-manifest-${new Date().toISOString().slice(0, 10)}.xls`,
    contentType: 'application/vnd.ms-excel; charset=utf-8',
    body: toExcelXml(headers, bodyRows, 'Customer Manifest'),
  };
}

async function manifestPdfBuffer(companyId, scheduleId, options = {}) {
  const manifest = buildManifest(companyId, scheduleId, options);
  return pdfBufferForRows({
    title: 'Classic Trip Manifest',
    subtitle: `${manifest.company.name || 'Company'} • ${manifest.schedule.id}`,
    context: [
      manifest.title,
      `Departure: ${manifest.departureLabel}`,
      `Vehicle: ${manifest.vehicle.name || manifest.schedule.vehicleName || '-'} • Driver: ${manifest.driverLabel}`,
      `Passengers: ${manifest.stats.passengers} • Checked in: ${manifest.stats.checkedIn} • No-show: ${manifest.stats.noShows}`,
    ],
    rows: manifest.passengers,
    footer: `Generated by ${manifest.generatedBy} at ${asDate(manifest.generatedAt)}. Passenger and driver signatures are required where company policy needs signed manifests.`,
  });
}

async function filteredCustomerPdfBuffer(companyId, filters = {}) {
  const rows = buildCustomerList(companyId, filters);
  return pdfBufferForRows({
    title: 'Classic Trip Customer Manifest',
    subtitle: `Company ${companyId || 'all companies'} • ${rows.length} passenger row(s)`,
    context: [`Filters: ${Object.entries(filters).filter(([, value]) => value).map(([key, value]) => `${key}=${value}`).join(', ') || 'none'}`],
    rows,
    footer: `Generated ${asDate(new Date().toISOString())}. Export is filterable by route, schedule, vehicle, driver, company, terminal, date, ticket status, check-in status, payment status, promoter, and booking source.`,
  });
}

async function pdfBufferForRows({ title, subtitle, context = [], rows = [], footer = '' }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 36, info: { Title: title } });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.rect(0, 0, 595, 96).fill('#111827');
      doc.fillColor('#ffffff').fontSize(21).text(title, 36, 28);
      doc.fontSize(10).fillColor('#cbd5e1').text(subtitle, 36, 58);
      let y = 118;
      context.forEach((line) => { doc.fontSize(10).fillColor('#475569').text(line, 36, y); y += 16; });
      y += 14;
      doc.fontSize(8).fillColor('#64748b');
      ['Booking', 'Ticket', 'Passenger', 'Seat', 'Pickup', 'Dropoff', 'Status'].forEach((header, index) => doc.text(header, [36, 92, 158, 272, 316, 386, 466][index], y, { width: [52, 62, 108, 38, 66, 74, 74][index] }));
      y += 18;
      doc.moveTo(36, y - 6).lineTo(558, y - 6).strokeColor('#e5e7eb').stroke();
      rows.forEach((row) => {
        if (y > 748) {
          doc.addPage();
          y = 46;
        }
        doc.fontSize(7.5).fillColor('#111827');
        doc.text(row.bookingRef, 36, y, { width: 52 });
        doc.text(row.ticketNumber, 92, y, { width: 62 });
        doc.text(row.passengerName, 158, y, { width: 108 });
        doc.text(row.seat, 272, y, { width: 38 });
        doc.text(row.pickupPoint, 316, y, { width: 66 });
        doc.text(row.dropoffPoint, 386, y, { width: 74 });
        doc.text(row.checkInStatus, 466, y, { width: 74 });
        y += 21;
      });
      y += 18;
      if (y < 730) {
        doc.fontSize(8).fillColor('#64748b').text('Passenger signature: ____________________________   Driver signature: ____________________________', 36, y, { width: 520 });
      }
      doc.fontSize(8).fillColor('#64748b').text(footer, 36, 790, { width: 520 });
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  buildManifest,
  buildCustomerList,
  bookingForCompany,
  bookingForSeat,
  manifestCsv,
  manifestExcel,
  filteredCustomerCsv,
  filteredCustomerExcel,
  manifestPdfBuffer,
  filteredCustomerPdfBuffer,
};

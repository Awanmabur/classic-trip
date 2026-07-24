'use strict';

function key(value) {
  return String(value == null ? '' : value).trim();
}

function normalize(value) {
  return key(value).toLowerCase().replace(/[-\s]+/g, '_');
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function rowId(row = {}) {
  return key(row?.id);
}

function firstById(rows = []) {
  return new Map(asArray(rows).filter((row) => row?.id).map((row) => [key(row.id), row]));
}

function seatNumberOf(seat = {}, index = 0) {
  return key(seat.seatNumber || seat.displayLabel || seat.label || seat.id || index + 1).toUpperCase();
}

function canonicalSeatStatus(value) {
  const status = normalize(value || 'available');
  if (['taken', 'booked', 'sold', 'confirmed', 'checked_in'].includes(status)) return 'booked';
  if (['locked', 'held', 'selected', 'pending_payment', 'reserved'].includes(status)) return 'held';
  if (['blocked', 'maintenance', 'disabled', 'unavailable', 'non_sellable'].includes(status)) return 'blocked';
  if (['cancelled', 'refunded', 'no_show'].includes(status)) return status;
  return 'available';
}

function scheduleRef(row = {}) {
  return key(row.scheduleId || row.departureId || row.tripScheduleId || row.tripId);
}

function isBusDepartureSchedule(schedule = {}, context = {}) {
  const listing = context.listingById?.get(key(schedule.listingId));
  const route = context.routeById?.get(key(schedule.routeId));
  const vehicle = context.vehicleById?.get(key(schedule.vehicleId));
  if (!listing || !route || !vehicle) return false;
  const companyId = key(schedule.companyId);
  return Boolean(
    companyId
    && key(listing.companyId) === companyId
    && key(route.companyId) === companyId
    && key(vehicle.companyId) === companyId
    && key(route.listingId) === key(listing.id)
    && key(vehicle.listingId) === key(listing.id)
    && normalize(listing.serviceType) === 'bus'
    && normalize(vehicle.serviceType) === 'bus'
  );
}

function bookingForSeat(bookings = [], scheduleId, seatNumber) {
  return asArray(bookings).find((booking) => {
    if (asArray(booking.ticketLegs).some((leg) => scheduleRef(leg) === scheduleId && seatNumberOf(leg) === seatNumber)) return true;
    if (asArray(booking.bookingItems).some((item) => scheduleRef(item) === scheduleId && seatNumberOf(item) === seatNumber)) return true;
    if (scheduleRef(booking) !== scheduleId) return false;
    return asArray(booking.passengers).some((passenger) => seatNumberOf({ seatNumber: passenger.seatNumber || passenger.seatOrRoom || passenger.seatLabel }) === seatNumber);
  }) || null;
}

function normalizedSeat(seat = {}, index, schedule, bookings) {
  const scheduleId = rowId(schedule);
  const seatNumber = seatNumberOf(seat, index);
  const booking = bookingForSeat(bookings, scheduleId, seatNumber);
  const ticket = asArray(booking?.ticketLegs).find((leg) => scheduleRef(leg) === scheduleId && seatNumberOf(leg) === seatNumber) || {};
  const passenger = asArray(booking?.passengers)[Number(ticket.passengerIndex || 0)]
    || asArray(booking?.passengers).find((row) => seatNumberOf({ seatNumber: row.seatNumber || row.seatOrRoom || row.seatLabel }) === seatNumber)
    || {};
  const status = booking ? 'booked' : canonicalSeatStatus(seat.status);
  return {
    id: rowId(seat) || `seat-${scheduleId}-${seatNumber}`,
    scheduleId,
    seatNumber,
    displayLabel: key(seat.displayLabel || seat.label || seatNumber),
    row: Number(seat.row || 0),
    col: Number(seat.col || 0),
    deck: key(seat.deck || 'main'),
    seatClass: key(seat.seatClass || 'Standard'),
    seatType: key(seat.seatType || normalize(seat.seatClass || 'standard')),
    status,
    priceDelta: Number(seat.priceDelta || 0),
    lockedUntil: seat.lockedUntil || '',
    lockId: key(seat.lockId),
    blockedReason: key(seat.blockedReason),
    bookingRef: key(booking?.bookingRef),
    passengerName: key(passenger.fullName || ticket.passengerName),
    passengerPhone: key(passenger.phone || booking?.guestSnapshot?.phone),
    passengerEmail: key(passenger.email || booking?.guestSnapshot?.email),
    ticketNumber: key(ticket.ticketNumber),
    checkInStatus: key(ticket.checkInStatus || booking?.checkInStatus),
    paymentStatus: key(booking?.paymentStatus),
  };
}

function sortSchedules(rows = []) {
  return [...rows].sort((a, b) => new Date(a.departAt || 0).getTime() - new Date(b.departAt || 0).getTime());
}

function buildLiveDepartureSeatMaps(input = {}) {
  const listingById = firstById(input.listings);
  const routeById = firstById(input.routes);
  const vehicleById = firstById(input.vehicles);
  const versionById = firstById(input.seatMapVersions);
  const context = { listingById, routeById, vehicleById };
  const seats = asArray(input.seats);
  const bookings = asArray(input.bookings);

  return sortSchedules(asArray(input.schedules).filter((schedule) => (
    schedule
    && normalize(schedule.status) !== 'archived'
    && isBusDepartureSchedule(schedule, context)
  ))).map((schedule) => {
    const scheduleId = rowId(schedule);
    const listing = listingById.get(key(schedule.listingId));
    const route = routeById.get(key(schedule.routeId));
    const vehicle = vehicleById.get(key(schedule.vehicleId));
    const version = versionById.get(key(schedule.seatMapVersionId));
    const scheduleSeats = seats
      .filter((seat) => scheduleRef(seat) === scheduleId)
      .map((seat, index) => normalizedSeat(seat, index, schedule, bookings));
    const bookedSeats = scheduleSeats.filter((seat) => seat.status === 'booked').length;
    const heldSeats = scheduleSeats.filter((seat) => seat.status === 'held').length;
    const blockedSeats = scheduleSeats.filter((seat) => seat.status === 'blocked').length;
    const availableSeats = scheduleSeats.filter((seat) => seat.status === 'available').length;
    const origin = schedule.routeSnapshot?.origin?.name || route.origin || listing.from;
    const destination = schedule.routeSnapshot?.destination?.name || route.destination || listing.to;
    return {
      id: scheduleId,
      scheduleId,
      listingId: listing.id,
      listingTitle: listing.title,
      routeId: route.id,
      routeLabel: key(route.routeName || [origin, destination].filter(Boolean).join(' to ')),
      vehicleId: vehicle.id,
      vehicleName: key(vehicle.name || vehicle.plateOrCode),
      layoutName: key(version?.layoutName || vehicle.layoutName || schedule.layoutName || '2x2'),
      rows: Number(version?.rows || vehicle.rows || 0),
      columns: Number(version?.columns || vehicle.columns || 0),
      seatMapVersionId: key(schedule.seatMapVersionId),
      seatMapVersion: Number(version?.version || 0) || '',
      departAt: schedule.departAt || '',
      travelDate: schedule.departAt || '',
      status: key(schedule.status),
      inventorySource: 'persisted_inventory',
      inventoryMissing: scheduleSeats.length === 0,
      totalSeats: scheduleSeats.length,
      bookedSeats,
      soldSeats: bookedSeats,
      heldSeats,
      blockedSeats,
      availableSeats,
      totals: { total: scheduleSeats.length, booked: bookedSeats, held: heldSeats, available: availableSeats, blocked: blockedSeats },
      seats: scheduleSeats,
    };
  });
}

module.exports = {
  buildLiveDepartureSeatMaps,
  isBusDepartureSchedule,
  canonicalSeatStatus,
  rowId,
};

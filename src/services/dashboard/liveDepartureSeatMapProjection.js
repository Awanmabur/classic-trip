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

function scheduleSeatKey(scheduleId, seatNumber) {
  return `${key(scheduleId)}:${key(seatNumber).toUpperCase()}`;
}

function buildBookingSeatIndex(bookings = []) {
  const index = new Map();
  asArray(bookings).forEach((booking) => {
    const passengers = asArray(booking.passengers);
    const add = (row = {}, rowType = 'ticket') => {
      const scheduleId = scheduleRef(row) || scheduleRef(booking);
      const seatNumber = seatNumberOf(row, -1);
      if (!scheduleId || !seatNumber || seatNumber === '0') return;
      const passengerIndex = Number(row.passengerIndex || 0);
      const passenger = passengers[passengerIndex]
        || passengers.find((candidate) => seatNumberOf({ seatNumber: candidate.seatNumber || candidate.seatOrRoom || candidate.seatLabel }, -1) === seatNumber)
        || {};
      const entryKey = scheduleSeatKey(scheduleId, seatNumber);
      if (!index.has(entryKey)) index.set(entryKey, {
        booking,
        ticket: rowType === 'ticket' ? row : {},
        passenger,
      });
    };
    asArray(booking.ticketLegs).forEach((leg) => add(leg, 'ticket'));
    asArray(booking.bookingLegs).forEach((leg) => add(leg, 'leg'));
    asArray(booking.bookingItems).forEach((item) => add(item, 'item'));
    const bookingScheduleId = scheduleRef(booking);
    if (bookingScheduleId) {
      passengers.forEach((passenger, passengerIndex) => add({
        scheduleId: bookingScheduleId,
        seatNumber: passenger.seatNumber || passenger.seatOrRoom || passenger.seatLabel,
        passengerIndex,
      }, 'passenger'));
    }
  });
  return index;
}

function normalizedSeat(seat = {}, index, schedule, bookingSeatIndex) {
  const scheduleId = rowId(schedule);
  const seatNumber = seatNumberOf(seat, index);
  const match = bookingSeatIndex.get(scheduleSeatKey(scheduleId, seatNumber)) || {};
  const booking = match.booking || null;
  const ticket = match.ticket || {};
  const passenger = match.passenger || {};
  const status = booking ? 'booked' : canonicalSeatStatus(seat.status);
  return {
    id: rowId(seat) || `seat-${scheduleId}-${seatNumber}`,
    scheduleId,
    seatNumber,
    displayLabel: key(seat.displayLabel || seat.label || seatNumber),
    row: Number(seat.row || 0),
    col: Number(seat.column || seat.col || 0),
    column: Number(seat.column || seat.col || 0),
    side: normalize(seat.side) === 'right' ? 'right' : normalize(seat.side) === 'left' ? 'left' : '',
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
  const seatsBySchedule = new Map();
  asArray(input.seats).forEach((seat) => {
    const scheduleId = scheduleRef(seat);
    if (!scheduleId) return;
    if (!seatsBySchedule.has(scheduleId)) seatsBySchedule.set(scheduleId, []);
    seatsBySchedule.get(scheduleId).push(seat);
  });
  const bookingSeatIndex = buildBookingSeatIndex(input.bookings);

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
    const scheduleSeats = asArray(seatsBySchedule.get(scheduleId))
      .map((seat, index) => normalizedSeat(seat, index, schedule, bookingSeatIndex));
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
      numberingStartSide: key(version?.numberingStartSide || vehicle.numberingStartSide || 'left'),
      driverPosition: key(version?.driverPosition || vehicle.driverPosition || 'right'),
      frontRowPassengerSeats: Number(version?.frontRowPassengerSeats ?? vehicle.frontRowPassengerSeats ?? 0) === 1 ? 1 : 0,
      rowLayoutOverrides: version?.rowLayoutOverrides || vehicle.rowLayoutOverrides || [],
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
  buildBookingSeatIndex,
};

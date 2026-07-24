'use strict';

const crypto = require('crypto');
const repository = require('../repositories/busRepository');
const {
  cleanText,
  normalize,
  unique,
  validationError,
  conflictError,
  sortStops,
  routeRange,
  requiredSegments,
  calculateFare,
  randomToken,
  hashToken,
  tokenPreview,
} = require('../domain/busDomain');
const { getCachedPlatformConfig } = require('../../../services/platform/platformConfigService');
const MAX_SEATS_PER_HOLD = 10;

function nowIso() { return new Date().toISOString(); }
function actorId(value) { return cleanText(value || 'guest', 180); }
function seatList(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return unique(raw.map((item) => cleanText(item, 20).toUpperCase())).slice(0, MAX_SEATS_PER_HOLD + 1);
}

async function scheduleContext(scheduleId, { requirePublished = true } = {}) {
  const schedule = await repository.schedules.findOne({ id: cleanText(scheduleId, 180) });
  if (!schedule) throw validationError('Bus departure not found', 404);
  if (requirePublished && !['published', 'delayed', 'boarding'].includes(normalize(schedule.status))) throw conflictError('This departure is not open for booking', 'departure_not_bookable');
  if (new Date(schedule.departAt).getTime() <= Date.now()) throw conflictError('This departure has already closed', 'departure_closed');
  const route = await repository.routes.findOne({ id: schedule.routeId, companyId: schedule.companyId, status: 'active' });
  const listing = await repository.listings.findOne({ id: schedule.listingId, companyId: schedule.companyId, serviceType: 'bus' });
  if (!route || !listing) throw conflictError('Departure route or bus service is unavailable', 'departure_configuration_missing');
  const stops = sortStops(await repository.routeStops.list({ companyId: schedule.companyId, routeId: route.id, status: { $ne: 'archived' } }, { sort: { stopOrder: 1 } }));
  const segments = await repository.routeSegments.list({ companyId: schedule.companyId, routeId: route.id, status: 'active' }, { sort: { segmentOrder: 1 } });
  const seatMapVersion = await repository.seatMapVersions.findOne({ id: schedule.seatMapVersionId, companyId: schedule.companyId, status: 'published' });
  const fareProduct = await repository.fareProducts.findOne({ id: schedule.fareProductId, companyId: schedule.companyId, status: 'active' });
  if (!seatMapVersion || !fareProduct) throw conflictError('Departure seat map or fare is unavailable', 'departure_configuration_missing');
  const fares = await repository.segmentFares.list({ fareProductId: fareProduct.id, companyId: schedule.companyId, status: 'active' });
  return { schedule, route, listing, stops, segments, seatMapVersion, fareProduct, fares };
}

async function expireStaleHolds(reference = new Date()) {
  const expired = await repository.holds.list({ holdType: 'bus_segment_seat', status: 'active', expiresAt: { $lte: reference } }, { limit: 500 });
  for (const hold of expired) await releaseHold(hold.id, 'expired', 'hold-expiry-job');
  return expired.length;
}

function inventoryStatusAvailable(row, allowedHoldId = '') {
  if (row.status === 'available') return true;
  return !!allowedHoldId && row.status === 'held' && row.holdId === allowedHoldId && new Date(row.lockedUntil).getTime() > Date.now();
}

async function getAvailability({ scheduleId, originStopId, destinationStopId, holdId = '' } = {}) {
  await expireStaleHolds();
  const context = await scheduleContext(scheduleId);
  const originId = cleanText(originStopId || context.schedule.originStopId || context.route.originStopId, 180);
  const destinationId = cleanText(destinationStopId || context.schedule.destinationStopId || context.route.destinationStopId, 180);
  const range = routeRange(context.stops, originId, destinationId);
  const selectedSegments = requiredSegments(context.segments, range);
  const segmentIds = selectedSegments.map((segment) => segment.id);
  const rows = await repository.segmentInventory.list({ scheduleId: context.schedule.id, segmentId: { $in: segmentIds } });
  const bySeat = new Map();
  for (const row of rows) {
    if (!bySeat.has(row.seatNumber)) bySeat.set(row.seatNumber, []);
    bySeat.get(row.seatNumber).push(row);
  }
  const seatDefinitions = new Map(context.seatMapVersion.seats.map((seat) => [String(seat.seatNumber), seat]));
  const seats = [...seatDefinitions.values()].map((definition) => {
    const inventory = bySeat.get(String(definition.seatNumber)) || [];
    const complete = inventory.length === selectedSegments.length;
    const available = definition.enabled !== false && complete && inventory.every((row) => inventoryStatusAvailable(row, holdId));
    const statuses = [...new Set(inventory.map((row) => row.status))];
    return {
      seatNumber: definition.seatNumber,
      row: definition.row,
      column: definition.column,
      deck: definition.deck,
      seatClass: definition.seatClass,
      seatType: definition.seatType,
      priceDelta: Number(definition.priceDelta || 0),
      accessible: !!definition.accessible,
      available,
      status: available ? 'available' : statuses.includes('booked') || statuses.includes('checked_in') || statuses.includes('no_show') ? 'booked' : statuses.includes('held') ? 'held' : statuses.includes('blocked') ? 'blocked' : definition.enabled === false ? 'disabled' : 'unavailable',
    };
  });
  const fare = calculateFare({ fares: context.fares, originStopId: range.origin.id, destinationStopId: range.destination.id, segments: context.segments, range, fallbackAmount: context.schedule.basePrice });
  return {
    schedule: {
      id: context.schedule.id,
      listingId: context.schedule.listingId,
      routeId: context.schedule.routeId,
      vehicleId: context.schedule.vehicleId,
      vehicleName: context.schedule.vehicleName,
      departAt: context.schedule.departAt,
      arriveAt: context.schedule.arriveAt,
      status: context.schedule.status,
      currency: context.schedule.currency,
      layoutName: context.seatMapVersion.layoutName || '2x2',
      rows: Number(context.seatMapVersion.rows || 0),
      columns: Number(context.seatMapVersion.columns || 0),
    },
    route: { id: context.route.id, routeName: context.route.routeName, routeCode: context.route.routeCode, origin: context.route.origin, destination: context.route.destination },
    journey: { originStopId: range.origin.id, originName: range.origin.name, destinationStopId: range.destination.id, destinationName: range.destination.name, originOrder: range.originOrder, destinationOrder: range.destinationOrder, segmentIds, segmentCount: selectedSegments.length },
    stops: context.stops.map((stop) => ({ id: stop.id, name: stop.name, stopType: stop.stopType, stopOrder: stop.stopOrder, pickupAllowed: stop.pickupAllowed, dropoffAllowed: stop.dropoffAllowed, publicInstructions: stop.publicInstructions })),
    seats,
    availableSeats: seats.filter((seat) => seat.available).length,
    fare: { baseAmountPerSeat: fare.amount, currency: context.fareProduct.currency, fareProductId: context.fareProduct.id, fareProductName: context.fareProduct.name, fareClass: context.fareProduct.fareClass, refundable: !!context.fareProduct.refundable, changeable: !!context.fareProduct.changeable, baggageAllowanceKg: Number(context.fareProduct.baggageAllowanceKg || 0), source: fare.source },
  };
}

async function recalculateCompatibilitySeat(scheduleId, seatNumber, session = null) {
  const rows = await repository.segmentInventory.list({ scheduleId, seatNumber }, session ? { session } : {});
  const seat = await repository.seats.findOne({ scheduleId, seatNumber }, session ? { session } : {});
  if (!seat) return null;
  const statuses = new Set(rows.map((row) => row.status));
  if (statuses.has('checked_in')) seat.status = 'checked_in';
  else if (statuses.has('no_show')) seat.status = 'no_show';
  else if (statuses.has('booked')) seat.status = 'taken';
  else if (statuses.has('held')) seat.status = 'locked';
  else if (statuses.has('blocked')) seat.status = 'blocked';
  else if (statuses.has('disabled')) seat.status = 'disabled';
  else seat.status = 'available';
  seat.lockId = statuses.has('held') ? rows.find((row) => row.status === 'held')?.holdId || null : null;
  seat.lockedUntil = statuses.has('held') ? rows.find((row) => row.status === 'held')?.lockedUntil || null : null;
  seat.updatedAt = nowIso();
  await repository.seats.save(seat, { scheduleId, seatNumber }, session ? { session } : {});
  return seat;
}

async function recalculateScheduleAvailableSeats(scheduleId, session = null) {
  const schedule = await repository.schedules.findOne({ id: scheduleId }, session ? { session } : {});
  if (!schedule) return 0;
  const rows = await repository.segmentInventory.list({ scheduleId }, session ? { session } : {});
  const bySeat = new Map();
  for (const row of rows) {
    if (!bySeat.has(row.seatNumber)) bySeat.set(row.seatNumber, []);
    bySeat.get(row.seatNumber).push(row);
  }
  schedule.availableSeats = [...bySeat.values()].filter((items) => items.length && items.every((item) => item.status === 'available')).length;
  schedule.updatedAt = nowIso();
  await repository.schedules.save(schedule, { id: schedule.id }, session ? { session } : {});
  return schedule.availableSeats;
}

async function holdSeats({ scheduleId, originStopId, destinationStopId, selectedSeats, context = {} } = {}) {
  await expireStaleHolds();
  const seats = seatList(selectedSeats);
  if (!seats.length) throw validationError('Select at least one seat');
  if (seats.length > MAX_SEATS_PER_HOLD) throw validationError(`A maximum of ${MAX_SEATS_PER_HOLD} seats can be held at once`);
  const availability = await getAvailability({ scheduleId, originStopId, destinationStopId });
  const availableMap = new Map(availability.seats.map((seat) => [String(seat.seatNumber).toUpperCase(), seat]));
  const unavailable = seats.filter((seatNumber) => !availableMap.get(seatNumber)?.available);
  if (unavailable.length) throw conflictError(`Seats are no longer available for this journey: ${unavailable.join(', ')}`, 'seat_unavailable');
  const holdMinutes = Math.max(1, Math.min(180, Number(getCachedPlatformConfig().holdMinutes))); 
  const timestamp = new Date();
  const expiresAt = new Date(timestamp.getTime() + holdMinutes * 60_000);
  const holdId = await repository.nextId('bus-hold');
  const token = randomToken(32);
  const hold = {
    id: holdId,
    holdType: 'bus_segment_seat',
    serviceType: 'bus',
    listingId: availability.schedule.listingId,
    companyId: (await repository.schedules.findOne({ id: availability.schedule.id })).companyId,
    scheduleId: availability.schedule.id,
    routeId: availability.schedule.routeId,
    originStopId: availability.journey.originStopId,
    destinationStopId: availability.journey.destinationStopId,
    originOrder: availability.journey.originOrder,
    destinationOrder: availability.journey.destinationOrder,
    segmentIds: availability.journey.segmentIds,
    seatNumber: seats[0],
    seatNumbers: seats,
    itemIds: [],
    itemCount: seats.length * availability.journey.segmentIds.length,
    selectedLabel: `${seats.join(', ')} · ${availability.journey.originName} to ${availability.journey.destinationName}`,
    token: hashToken(token),
    tokenPreview: tokenPreview(token),
    guest: context.guest || {},
    status: 'active',
    lockedUntil: expiresAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    createdBy: actorId(context.createdBy),
    source: cleanText(context.source || 'public_bus_hold', 100),
    meta: { ip: cleanText(context.ip, 80), userAgent: cleanText(context.userAgent, 300), requestId: cleanText(context.requestId, 180) },
    createdAt: timestamp.toISOString(),
    updatedAt: timestamp.toISOString(),
  };
  const inventoryRows = await repository.segmentInventory.list({ scheduleId: hold.scheduleId, seatNumber: { $in: seats }, segmentId: { $in: hold.segmentIds } });
  const expected = seats.length * hold.segmentIds.length;
  if (inventoryRows.length !== expected) throw conflictError('Seat inventory is incomplete; refresh the departure before booking', 'inventory_incomplete');
  const holdItems = [];
  for (const row of inventoryRows) {
    holdItems.push({
      id: await repository.nextId('hold-item'),
      holdId,
      resourceType: 'bus_seat_segment',
      resourceKey: `bus:${hold.scheduleId}:${row.seatNumber}:${row.segmentId}`,
      serviceType: 'bus',
      companyId: hold.companyId,
      listingId: hold.listingId,
      scheduleId: hold.scheduleId,
      routeId: hold.routeId,
      seatNumber: row.seatNumber,
      segmentId: row.segmentId,
      segmentOrder: row.segmentOrder,
      originStopId: hold.originStopId,
      destinationStopId: hold.destinationStopId,
      selectedLabel: `${row.seatNumber} / segment ${row.segmentOrder + 1}`,
      status: 'active',
      expiresAt: expiresAt.toISOString(),
      metadata: { fromStopId: row.fromStopId, toStopId: row.toStopId },
      createdAt: timestamp.toISOString(),
    });
  }
  hold.itemIds = holdItems.map((item) => item.id);

  try {
    await repository.withTransaction(async (session) => {
      // Re-check inside the transaction. The active resource-key unique index is the second line of defense.
      const fresh = await repository.segmentInventory.list({ scheduleId: hold.scheduleId, seatNumber: { $in: seats }, segmentId: { $in: hold.segmentIds }, status: 'available' }, { session });
      if (fresh.length !== expected) throw conflictError('One or more selected seats were just taken; choose again', 'seat_unavailable');
      await repository.holds.save(hold, { id: hold.id }, { session });
      await repository.holdItems.saveMany(holdItems, null, { session });
      for (const row of fresh) {
        row.status = 'held';
        row.holdId = hold.id;
        row.lockedUntil = expiresAt.toISOString();
        row.updatedAt = timestamp.toISOString();
      }
      await repository.segmentInventory.saveMany(fresh, null, { session });
      for (const seatNumber of seats) await recalculateCompatibilitySeat(hold.scheduleId, seatNumber, session);
      await recalculateScheduleAvailableSeats(hold.scheduleId, session);
      await repository.outbox({ eventType: 'BusInventoryHeld', aggregateType: 'inventory_hold', aggregateId: hold.id, companyId: hold.companyId, payload: { scheduleId: hold.scheduleId, seatNumbers: seats, segmentIds: hold.segmentIds, expiresAt: hold.expiresAt }, dedupeKey: `BusInventoryHeld:${hold.id}`, session });
      await repository.audit({ actorId: actorId(context.createdBy), action: 'bus.inventory.held', targetType: 'inventory_hold', targetId: hold.id, companyId: hold.companyId, metadata: { scheduleId: hold.scheduleId, seats, segmentIds: hold.segmentIds }, session });
    });
  } catch (error) {
    if (error.code === 11000) throw conflictError('One or more selected seats were just held by another traveler', 'seat_unavailable');
    throw error;
  }
  return { ...hold, accessToken: token, seats: seats.map((seatNumber) => availableMap.get(seatNumber)), fare: availability.fare, journey: availability.journey };
}

async function assertActiveHold(holdId, token = '', session = null) {
  if (!session) await expireStaleHolds();
  const options = session ? { session } : {};
  const hold = await repository.holds.findOne({ id: cleanText(holdId, 180), holdType: 'bus_segment_seat' }, options);
  if (!hold) throw validationError('Bus seat hold not found', 404);
  if (hold.status !== 'active' || new Date(hold.expiresAt).getTime() <= Date.now()) throw conflictError('This seat hold has expired', 'hold_expired');
  if (token) {
    const expected = Buffer.from(String(hold.token || ''), 'utf8');
    const supplied = Buffer.from(String(hashToken(token) || ''), 'utf8');
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
      throw validationError('Invalid seat-hold access token', 403);
    }
  }
  return hold;
}

async function attachHoldToBooking(holdId, booking, actor = 'system', session = null) {
  const hold = await assertActiveHold(holdId, '', session);
  hold.bookingId = booking.id;
  hold.bookingRef = booking.bookingRef;
  hold.updatedAt = nowIso();
  await repository.holds.save(hold, { id: hold.id }, session ? { session } : {});
  const items = await repository.holdItems.list({ holdId: hold.id, status: 'active' }, session ? { session } : {});
  for (const item of items) {
    item.bookingId = booking.id;
    item.bookingRef = booking.bookingRef;
  }
  if (items.length) await repository.holdItems.saveMany(items, null, session ? { session } : {});
  await repository.audit({ actorId: actorId(actor), action: 'bus.inventory.attached_to_booking', targetType: 'inventory_hold', targetId: hold.id, companyId: hold.companyId, metadata: { bookingId: booking.id, bookingRef: booking.bookingRef }, session });
  return hold;
}

async function consumeHold(holdId, { bookingId, bookingRef, bookingItemId, reservationId, assignments = [], tickets = [], actor = 'payment-settlement', session = null } = {}) {
  const hold = await assertActiveHold(holdId, '', session);
  const assignmentBySeat = new Map(assignments.map((item) => [String(item.seatNumber), item]));
  const ticketBySeat = new Map(tickets.map((item) => [String(item.seatNumber), item]));
  const rows = await repository.segmentInventory.list({ holdId: hold.id, status: 'held' }, session ? { session } : {});
  if (rows.length !== hold.itemCount) throw conflictError('Held bus inventory is incomplete and requires reconciliation', 'hold_inventory_mismatch');
  const timestamp = nowIso();
  for (const row of rows) {
    const assignment = assignmentBySeat.get(String(row.seatNumber));
    const ticket = ticketBySeat.get(String(row.seatNumber));
    row.status = 'booked';
    row.bookingId = bookingId;
    row.bookingItemId = bookingItemId;
    row.reservationId = reservationId;
    row.passengerId = assignment?.passengerId || '';
    row.ticketId = ticket?.id || '';
    row.holdId = '';
    row.lockedUntil = null;
    row.updatedAt = timestamp;
  }
  hold.status = 'consumed';
  hold.consumedAt = timestamp;
  hold.consumedBy = actorId(actor);
  hold.bookingId = bookingId;
  hold.bookingRef = bookingRef;
  hold.updatedAt = timestamp;
  const items = await repository.holdItems.list({ holdId: hold.id, status: 'active' }, session ? { session } : {});
  for (const item of items) {
    item.status = 'consumed';
    item.consumedAt = timestamp;
    item.consumedBy = actorId(actor);
    item.bookingId = bookingId;
    item.bookingRef = bookingRef;
  }
  await repository.segmentInventory.saveMany(rows, null, session ? { session } : {});
  await repository.holds.save(hold, { id: hold.id }, session ? { session } : {});
  if (items.length) await repository.holdItems.saveMany(items, null, session ? { session } : {});
  for (const seatNumber of hold.seatNumbers || [hold.seatNumber]) await recalculateCompatibilitySeat(hold.scheduleId, seatNumber, session);
  await recalculateScheduleAvailableSeats(hold.scheduleId, session);
  await repository.outbox({ eventType: 'BusInventoryBooked', aggregateType: 'inventory_hold', aggregateId: hold.id, companyId: hold.companyId, payload: { bookingId, bookingRef, reservationId, scheduleId: hold.scheduleId, seatNumbers: hold.seatNumbers }, dedupeKey: `BusInventoryBooked:${hold.id}:${bookingId}`, session });
  return hold;
}

async function releaseHold(holdId, reason = 'released', actor = 'system', session = null) {
  const hold = await repository.holds.findOne({ id: cleanText(holdId, 180), holdType: 'bus_segment_seat' }, session ? { session } : {});
  if (!hold || hold.status !== 'active') return hold;
  const timestamp = nowIso();
  const rows = await repository.segmentInventory.list({ holdId: hold.id, status: 'held' }, session ? { session } : {});
  for (const row of rows) {
    row.status = 'available';
    row.holdId = '';
    row.lockedUntil = null;
    row.updatedAt = timestamp;
  }
  const nextStatus = reason === 'expired' ? 'expired' : 'released';
  hold.status = nextStatus;
  hold.releasedAt = timestamp;
  hold.releaseReason = cleanText(reason, 500);
  hold.updatedAt = timestamp;
  const items = await repository.holdItems.list({ holdId: hold.id, status: 'active' }, session ? { session } : {});
  for (const item of items) {
    item.status = nextStatus;
    item.releasedAt = timestamp;
    item.releaseReason = hold.releaseReason;
  }
  const execute = async (activeSession) => {
    if (rows.length) await repository.segmentInventory.saveMany(rows, null, activeSession ? { session: activeSession } : {});
    await repository.holds.save(hold, { id: hold.id }, activeSession ? { session: activeSession } : {});
    if (items.length) await repository.holdItems.saveMany(items, null, activeSession ? { session: activeSession } : {});
    for (const seatNumber of hold.seatNumbers || [hold.seatNumber]) await recalculateCompatibilitySeat(hold.scheduleId, seatNumber, activeSession);
    await recalculateScheduleAvailableSeats(hold.scheduleId, activeSession);
    await repository.outbox({ eventType: reason === 'expired' ? 'BusInventoryHoldExpired' : 'BusInventoryReleased', aggregateType: 'inventory_hold', aggregateId: hold.id, companyId: hold.companyId, payload: { scheduleId: hold.scheduleId, reason }, dedupeKey: `BusInventoryReleased:${hold.id}:${nextStatus}`, session: activeSession });
    await repository.audit({ actorId: actorId(actor), action: `bus.inventory.${nextStatus}`, targetType: 'inventory_hold', targetId: hold.id, companyId: hold.companyId, metadata: { reason }, session: activeSession });
  };
  if (session) await execute(session);
  else await repository.withTransaction(execute);
  return hold;
}

module.exports = {
  MAX_SEATS_PER_HOLD,
  scheduleContext,
  expireStaleHolds,
  getAvailability,
  holdSeats,
  assertActiveHold,
  attachHoldToBooking,
  consumeHold,
  releaseHold,
  recalculateCompatibilitySeat,
  recalculateScheduleAvailableSeats,
};

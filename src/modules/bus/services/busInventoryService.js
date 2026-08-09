'use strict';

const crypto = require('crypto');
const { formatRouteLabel } = require('../../../utils/routeLabel');
const { priceBusTicket } = require('../../../utils/busCustomerPricing');
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
const logger = require('../../../config/logger');
const MAX_SEATS_PER_HOLD = 10;
const STATIC_CONTEXT_TTL_MS = 30_000;
const STATIC_CONTEXT_CACHE_LIMIT = 300;
const SCHEDULE_STATE_TTL_MS = 5000;
const SCHEDULE_STATE_CACHE_LIMIT = 500;
const staticContextCache = new Map();
const staticContextInflight = new Map();
const scheduleStateCache = new Map();
const scheduleStateInflight = new Map();
const compatibilityRefreshQueue = new Map();
let compatibilityRefreshTimer = null;
let compatibilityRefreshRunning = false;

function nowIso() { return new Date().toISOString(); }
function actorId(value) { return cleanText(value || 'guest', 180); }
function seatList(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return unique(raw.map((item) => cleanText(item, 20).toUpperCase())).slice(0, MAX_SEATS_PER_HOLD + 1);
}

function staticContextKey(schedule = {}) {
  return [schedule.companyId, schedule.routeId, schedule.listingId, schedule.seatMapVersionId, schedule.fareProductId].join('|');
}

function cacheStaticContext(key, value) {
  if (staticContextCache.size >= STATIC_CONTEXT_CACHE_LIMIT) {
    const oldest = staticContextCache.keys().next().value;
    if (oldest) staticContextCache.delete(oldest);
  }
  staticContextCache.set(key, { value, expiresAt: Date.now() + STATIC_CONTEXT_TTL_MS });
}

function cacheScheduleState(key, value) {
  if (scheduleStateCache.size >= SCHEDULE_STATE_CACHE_LIMIT) {
    const oldest = scheduleStateCache.keys().next().value;
    if (oldest) scheduleStateCache.delete(oldest);
  }
  scheduleStateCache.set(key, { value, expiresAt: Date.now() + SCHEDULE_STATE_TTL_MS });
  return value;
}

async function scheduleRecord(scheduleId) {
  const id = cleanText(scheduleId, 180);
  const cached = scheduleStateCache.get(id);
  if (cached?.expiresAt > Date.now()) return cached.value;
  if (cached) scheduleStateCache.delete(id);
  let inflight = scheduleStateInflight.get(id);
  if (!inflight) {
    inflight = repository.schedules.findOne({ id })
      .then((value) => value ? cacheScheduleState(id, value) : null)
      .finally(() => scheduleStateInflight.delete(id));
    scheduleStateInflight.set(id, inflight);
  }
  return inflight;
}

function contextFromScheduleSnapshots(schedule = {}) {
  const routeSnapshot = schedule.routeSnapshot || {};
  const seatSnapshot = schedule.seatMapSnapshot || {};
  const fareSnapshot = schedule.fareSnapshot || {};
  const stops = sortStops(Array.isArray(routeSnapshot.stops) ? routeSnapshot.stops : []);
  const segments = Array.isArray(routeSnapshot.segments) ? routeSnapshot.segments : [];
  const rawSeats = Array.isArray(seatSnapshot.seats) ? seatSnapshot.seats : [];
  if (stops.length < 2 || !segments.length || !rawSeats.length || !fareSnapshot.fareProductId) return null;
  const route = {
    id: routeSnapshot.routeId || schedule.routeId,
    routeName: routeSnapshot.routeName || '',
    routeCode: routeSnapshot.routeCode || '',
    version: routeSnapshot.version || schedule.routeVersion || 1,
    timezone: routeSnapshot.timezone || 'Africa/Kampala',
    origin: routeSnapshot.origin?.name || routeSnapshot.origin || '',
    destination: routeSnapshot.destination?.name || routeSnapshot.destination || '',
    originStopId: schedule.originStopId || routeSnapshot.origin?.id || stops[0]?.id,
    destinationStopId: schedule.destinationStopId || routeSnapshot.destination?.id || stops[stops.length - 1]?.id,
  };
  const seatMapVersion = {
    id: seatSnapshot.versionId || schedule.seatMapVersionId,
    templateId: seatSnapshot.templateId || schedule.seatMapTemplateId,
    version: seatSnapshot.version || 1,
    checksum: seatSnapshot.checksum || '',
    vehicleClass: seatSnapshot.vehicleClass || schedule.vehicleClass || 'standard',
    layoutName: seatSnapshot.layoutName || '2x2',
    rows: Number(seatSnapshot.rows || 0),
    columns: Number(seatSnapshot.columns || 0),
    totalSeats: Number(seatSnapshot.totalSeats || rawSeats.length),
    numberingStartSide: seatSnapshot.numberingStartSide || 'left',
    driverPosition: seatSnapshot.driverPosition || 'right',
    frontRowPassengerSeats: Number(seatSnapshot.frontRowPassengerSeats || 0) === 1 ? 1 : 0,
    rowLayoutOverrides: Array.isArray(seatSnapshot.rowLayoutOverrides) ? seatSnapshot.rowLayoutOverrides : [],
    seats: rawSeats.map((seat) => ({
      ...seat,
      column: Number(seat.column ?? seat.col ?? 0),
      col: Number(seat.col ?? seat.column ?? 0),
      side: seat.side || '',
      enabled: seat.enabled !== false,
    })),
  };
  const fareProduct = {
    id: fareSnapshot.fareProductId || schedule.fareProductId,
    name: fareSnapshot.name || schedule.fareClass || 'Standard fare',
    fareClass: fareSnapshot.fareClass || schedule.fareClass || 'standard',
    currency: fareSnapshot.currency || schedule.currency,
    refundable: !!fareSnapshot.refundable,
    changeable: !!fareSnapshot.changeable,
    baggageAllowanceKg: Number(fareSnapshot.baggageAllowanceKg || 0),
    status: 'active',
  };
  return {
    route,
    stops,
    segments,
    seatMapVersion,
    fareProduct,
    fares: Array.isArray(fareSnapshot.fares) ? fareSnapshot.fares : [],
    snapshotBacked: true,
  };
}

async function scheduleContext(scheduleId, { requirePublished = true } = {}) {
  // Read the mutable departure status once, then use its immutable publication
  // snapshots for route/stops/segments/seat layout/fare metadata. Existing code
  // re-read seven collections from Atlas for every stop change and checkout.
  const schedule = await scheduleRecord(scheduleId);
  if (!schedule) throw validationError('Bus departure not found', 404);
  if (requirePublished && !['published', 'delayed', 'boarding'].includes(normalize(schedule.status))) throw conflictError('This departure is not open for booking', 'departure_not_bookable');
  if (new Date(schedule.departAt).getTime() <= Date.now()) throw conflictError('This departure has already closed', 'departure_closed');
  const key = staticContextKey(schedule);
  const cached = staticContextCache.get(key);
  let staticContext = cached && cached.expiresAt > Date.now() ? cached.value : null;
  if (cached && !staticContext) staticContextCache.delete(key);
  if (!staticContext) {
    let inflight = staticContextInflight.get(key);
    if (!inflight) {
      inflight = (async () => {
        const snapshotContext = contextFromScheduleSnapshots(schedule);
        const [listing, route, stopsRaw, segments, seatMapVersion, fareProduct] = await Promise.all([
          repository.listings.findOne({ id: schedule.listingId, companyId: schedule.companyId, serviceType: 'bus', status: 'active', releaseStatus: 'published' }),
          snapshotContext ? Promise.resolve(snapshotContext.route) : repository.routes.findOne({ id: schedule.routeId, companyId: schedule.companyId, status: 'active' }),
          snapshotContext ? Promise.resolve(snapshotContext.stops) : repository.routeStops.list({ companyId: schedule.companyId, routeId: schedule.routeId, status: { $ne: 'archived' } }, { sort: { stopOrder: 1 }, limit: 240 }),
          snapshotContext ? Promise.resolve(snapshotContext.segments) : repository.routeSegments.list({ companyId: schedule.companyId, routeId: schedule.routeId, status: 'active' }, { sort: { segmentOrder: 1 }, limit: 240 }),
          snapshotContext ? Promise.resolve(snapshotContext.seatMapVersion) : repository.seatMapVersions.findOne({ id: schedule.seatMapVersionId, companyId: schedule.companyId, status: 'published' }),
          snapshotContext ? Promise.resolve(snapshotContext.fareProduct) : repository.fareProducts.findOne({ id: schedule.fareProductId, companyId: schedule.companyId, status: 'active' }),
        ]);
        if (!route || !listing) throw conflictError('Departure route or bus service is unavailable', 'departure_configuration_missing');
        if (!seatMapVersion || !fareProduct) throw conflictError('Departure seat map or fare is unavailable', 'departure_configuration_missing');
        const value = {
          route,
          listing,
          stops: sortStops(stopsRaw),
          segments,
          seatMapVersion,
          fareProduct,
          fares: snapshotContext?.fares || [],
          snapshotBacked: !!snapshotContext,
          cacheKey: key,
        };
        cacheStaticContext(key, value);
        return value;
      })().finally(() => staticContextInflight.delete(key));
      staticContextInflight.set(key, inflight);
    }
    staticContext = await inflight;
  }
  return { schedule, ...staticContext };
}

async function expireStaleHolds(reference = new Date()) {
  const expired = await repository.holds.list({ holdType: 'bus_segment_seat', status: 'active', expiresAt: { $lte: reference } }, { limit: 500 });
  for (const hold of expired) await releaseHold(hold.id, 'expired', 'hold-expiry-job');
  return expired.length;
}

function inventoryStatusAvailable(row, allowedHoldId = '') {
  if (row.status === 'available') return true;
  if (row.status === 'held' && new Date(row.lockedUntil).getTime() <= Date.now()) return true;
  return !!allowedHoldId && row.status === 'held' && row.holdId === allowedHoldId && new Date(row.lockedUntil).getTime() > Date.now();
}

async function getAvailability({ scheduleId, originStopId, destinationStopId, holdId = '', seatNumbers = [] } = {}) {
  const context = await scheduleContext(scheduleId);
  const originId = cleanText(originStopId || context.schedule.originStopId || context.route.originStopId, 180);
  const destinationId = cleanText(destinationStopId || context.schedule.destinationStopId || context.route.destinationStopId, 180);
  const range = routeRange(context.stops, originId, destinationId);
  const selectedSegments = requiredSegments(context.segments, range);
  const segmentIds = selectedSegments.map((segment) => segment.id);
  const requestedSeats = seatList(seatNumbers);
  const definitions = (context.seatMapVersion.seats || []).filter((seat) => !requestedSeats.length || requestedSeats.includes(String(seat.seatNumber || '').toUpperCase()));
  const inventoryFilter = { scheduleId: context.schedule.id, segmentId: { $in: segmentIds } };
  if (requestedSeats.length) inventoryFilter.seatNumber = { $in: requestedSeats };
  const expectedInventoryRows = Math.max(1, definitions.length * selectedSegments.length);
  const rows = await repository.segmentInventory.list(inventoryFilter, {
    sort: { seatNumber: 1, segmentOrder: 1 },
    limit: expectedInventoryRows + 10,
  });
  const bySeat = new Map();
  for (const row of rows) {
    if (!bySeat.has(row.seatNumber)) bySeat.set(row.seatNumber, []);
    bySeat.get(row.seatNumber).push(row);
  }
  const seatDefinitions = new Map(definitions.map((seat) => [String(seat.seatNumber), seat]));
  const seats = [...seatDefinitions.values()].map((definition) => {
    const inventory = bySeat.get(String(definition.seatNumber)) || [];
    const complete = inventory.length === selectedSegments.length;
    const available = definition.enabled !== false && complete && inventory.every((row) => inventoryStatusAvailable(row, holdId));
    const statuses = [...new Set(inventory.map((row) => (
      row.status === 'held' && new Date(row.lockedUntil).getTime() <= Date.now() ? 'available' : row.status
    )))];
    return {
      seatNumber: definition.seatNumber,
      row: definition.row,
      column: definition.column,
      side: definition.side || '',
      deck: definition.deck,
      seatClass: definition.seatClass,
      seatType: definition.seatType,
      priceDelta: Number(definition.priceDelta || 0),
      accessible: !!definition.accessible,
      available,
      status: available ? 'available' : statuses.includes('booked') || statuses.includes('checked_in') || statuses.includes('no_show') ? 'booked' : statuses.includes('held') ? 'held' : statuses.includes('blocked') ? 'blocked' : definition.enabled === false ? 'disabled' : 'unavailable',
    };
  });
  const fullPublishedJourney = String(range.origin.id) === String(context.schedule.originStopId || context.route.originStopId)
    && String(range.destination.id) === String(context.schedule.destinationStopId || context.route.destinationStopId);
  let fareRows = context.fares || [];
  // Older departures do not contain the new compact fare rows. Their initial
  // full-route fare is already frozen in schedule.basePrice, so query detailed
  // fares only when the traveler actually chooses an intermediate stop pair.
  if (!fareRows.length && !fullPublishedJourney) {
    fareRows = await repository.segmentFares.list({
      fareProductId: context.schedule.fareProductId,
      companyId: context.schedule.companyId,
      status: 'active',
    }, { sort: { fromOrder: 1, toOrder: 1 }, limit: 2000 });
    context.fares = fareRows;
    const cachedStatic = staticContextCache.get(context.cacheKey);
    if (cachedStatic?.value) {
      cachedStatic.value.fares = fareRows;
      cachedStatic.expiresAt = Date.now() + STATIC_CONTEXT_TTL_MS;
    }
  }
  const fare = calculateFare({ fares: fareRows, originStopId: range.origin.id, destinationStopId: range.destination.id, segments: context.segments, range, fallbackAmount: context.schedule.basePrice });
  const customerBasePricing = priceBusTicket({
    partnerFare: fare.amount,
    seatDelta: 0,
    isMainRoute: fullPublishedJourney,
    currency: context.fareProduct.currency,
  });
  return {
    schedule: {
      id: context.schedule.id,
      companyId: context.schedule.companyId,
      listingId: context.schedule.listingId,
      routeId: context.schedule.routeId,
      vehicleId: context.schedule.vehicleId,
      vehicleName: context.schedule.vehicleName,
      vehicleClass: normalize(context.schedule.vehicleClass || context.seatMapVersion.vehicleClass) === 'vip' ? 'vip' : 'standard',
      departAt: context.schedule.departAt,
      arriveAt: context.schedule.arriveAt,
      status: context.schedule.status,
      currency: context.schedule.currency,
      layoutName: context.seatMapVersion.layoutName || '2x2',
      rows: Number(context.seatMapVersion.rows || 0),
      columns: Number(context.seatMapVersion.columns || 0),
      numberingStartSide: context.seatMapVersion.numberingStartSide || 'left',
      driverPosition: context.seatMapVersion.driverPosition || 'right',
      frontRowPassengerSeats: Number(context.seatMapVersion.frontRowPassengerSeats || 0) === 1 ? 1 : 0,
      rowLayoutOverrides: context.seatMapVersion.rowLayoutOverrides || [],
    },
    route: { id: context.route.id, routeName: context.route.routeName, routeCode: context.route.routeCode, origin: context.route.origin, destination: context.route.destination },
    journey: { originStopId: range.origin.id, originBranchId: range.origin.branchId || '', originName: range.origin.name, destinationStopId: range.destination.id, destinationBranchId: range.destination.branchId || '', destinationName: range.destination.name, originOrder: range.originOrder, destinationOrder: range.destinationOrder, segmentIds, segmentCount: selectedSegments.length },
    stops: context.stops.map((stop) => ({ id: stop.id, branchId: stop.branchId || '', name: stop.name, stopType: stop.stopType, stopOrder: stop.stopOrder, pickupAllowed: stop.pickupAllowed, dropoffAllowed: stop.dropoffAllowed, publicInstructions: stop.publicInstructions })),
    seats,
    availableSeats: seats.filter((seat) => seat.available).length,
    fare: { baseAmountPerSeat: customerBasePricing.customerFare, partnerBaseAmountPerSeat: fare.amount, discountAmountPerSeat: customerBasePricing.discount, serviceFeePerSeat: customerBasePricing.serviceFee, isMainRoute: fullPublishedJourney, currency: context.fareProduct.currency, fareProductId: context.fareProduct.id, fareProductName: context.fareProduct.name, fareClass: context.fareProduct.fareClass, refundable: !!context.fareProduct.refundable, changeable: !!context.fareProduct.changeable, baggageAllowanceKg: Number(context.fareProduct.baggageAllowanceKg || 0), source: fare.source },
  };
}

async function recalculateCompatibilitySeats(scheduleId, seatNumbers, session = null) {
  const numbers = unique((Array.isArray(seatNumbers) ? seatNumbers : [seatNumbers])
    .map((value) => cleanText(value, 20).toUpperCase())
    .filter(Boolean));
  if (!numbers.length) return [];
  const options = session ? { session } : {};
  let rows;
  let seats;
  if (session) {
    rows = await repository.segmentInventory.list({ scheduleId, seatNumber: { $in: numbers } }, options);
    seats = await repository.seats.list({ scheduleId, seatNumber: { $in: numbers } }, options);
  } else {
    [rows, seats] = await Promise.all([
      repository.segmentInventory.list({ scheduleId, seatNumber: { $in: numbers } }, options),
      repository.seats.list({ scheduleId, seatNumber: { $in: numbers } }, options),
    ]);
  }
  const rowsBySeat = new Map(numbers.map((number) => [number, []]));
  for (const row of rows) {
    const key = String(row.seatNumber || '').toUpperCase();
    if (rowsBySeat.has(key)) rowsBySeat.get(key).push(row);
  }
  const timestamp = nowIso();
  for (const seat of seats) {
    const seatRows = rowsBySeat.get(String(seat.seatNumber || '').toUpperCase()) || [];
    const statuses = new Set(seatRows.map((row) => row.status));
    if (statuses.has('checked_in')) seat.status = 'checked_in';
    else if (statuses.has('no_show')) seat.status = 'no_show';
    else if (statuses.has('booked')) seat.status = 'taken';
    else if (statuses.has('held')) seat.status = 'locked';
    else if (statuses.has('blocked')) seat.status = 'blocked';
    else if (statuses.has('disabled')) seat.status = 'disabled';
    else seat.status = 'available';
    const activeHold = seatRows.find((row) => row.status === 'held') || null;
    seat.lockId = activeHold?.holdId || null;
    seat.lockedUntil = activeHold?.lockedUntil || null;
    seat.updatedAt = timestamp;
  }
  if (seats.length) await repository.seats.saveMany(seats, null, options);
  return seats;
}

async function recalculateCompatibilitySeat(scheduleId, seatNumber, session = null) {
  const seats = await recalculateCompatibilitySeats(scheduleId, [seatNumber], session);
  return seats[0] || null;
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

async function drainCompatibilityRefreshQueue() {
  if (compatibilityRefreshRunning) return;
  compatibilityRefreshRunning = true;
  try {
    while (compatibilityRefreshQueue.size) {
      const [scheduleId, seatNumbers] = compatibilityRefreshQueue.entries().next().value;
      compatibilityRefreshQueue.delete(scheduleId);
      try {
        // These are compatibility summaries only. Segment inventory remains the
        // authoritative booking state, so checkout does not wait for this scan.
        await recalculateCompatibilitySeats(scheduleId, [...seatNumbers]);
        await recalculateScheduleAvailableSeats(scheduleId);
      } catch (error) {
        logger.warn('Deferred bus inventory summary refresh failed', { scheduleId, error: error.message });
      }
    }
  } finally {
    compatibilityRefreshRunning = false;
  }
}

function queueCompatibilityRefresh(scheduleId, seatNumbers = []) {
  const key = cleanText(scheduleId, 180);
  if (!key) return;
  const existing = compatibilityRefreshQueue.get(key) || new Set();
  seatList(seatNumbers).forEach((seatNumber) => existing.add(seatNumber));
  compatibilityRefreshQueue.set(key, existing);
  if (compatibilityRefreshTimer) return;
  compatibilityRefreshTimer = setTimeout(() => {
    compatibilityRefreshTimer = null;
    drainCompatibilityRefreshQueue().catch((error) => logger.warn('Deferred bus inventory refresh queue failed', { error: error.message }));
  }, 1500);
  compatibilityRefreshTimer.unref?.();
}

async function holdSeats({ scheduleId, originStopId, destinationStopId, selectedSeats, context = {} } = {}) {
  const seats = seatList(selectedSeats);
  if (!seats.length) throw validationError('Select at least one seat');
  if (seats.length > MAX_SEATS_PER_HOLD) throw validationError(`A maximum of ${MAX_SEATS_PER_HOLD} seats can be held at once`);
  const [availability, holdId] = await Promise.all([
    getAvailability({ scheduleId, originStopId, destinationStopId, seatNumbers: seats }),
    repository.nextId('bus-hold'),
  ]);
  const availableMap = new Map(availability.seats.map((seat) => [String(seat.seatNumber).toUpperCase(), seat]));
  const unavailable = seats.filter((seatNumber) => !availableMap.get(seatNumber)?.available);
  if (unavailable.length) throw conflictError(`Seats are no longer available for this journey: ${unavailable.join(', ')}`, 'seat_unavailable');
  const holdMinutes = Math.max(1, Math.min(180, Number(getCachedPlatformConfig().holdMinutes))); 
  const timestamp = new Date();
  const expiresAt = new Date(timestamp.getTime() + holdMinutes * 60_000);
  const token = randomToken(32);
  const hold = {
    id: holdId,
    holdType: 'bus_segment_seat',
    serviceType: 'bus',
    listingId: availability.schedule.listingId,
    companyId: availability.schedule.companyId,
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
    selectedLabel: `${seats.join(', ')} · ${formatRouteLabel(availability.journey.originName, availability.journey.destinationName)}`,
    token: hashToken(token),
    tokenPreview: tokenPreview(token),
    guest: context.guest || {},
    status: 'active',
    lockedUntil: expiresAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    createdBy: actorId(context.createdBy),
    source: cleanText(context.source || 'public_bus_hold', 100),
    meta: {
      ip: cleanText(context.ip, 80),
      userAgent: cleanText(context.userAgent, 300),
      requestId: cleanText(context.requestId, 180),
      journey: {
        originBranchId: availability.journey.originBranchId || '',
        destinationBranchId: availability.journey.destinationBranchId || '',
        originName: availability.journey.originName || '',
        destinationName: availability.journey.destinationName || '',
      },
    },
    createdAt: timestamp.toISOString(),
    updatedAt: timestamp.toISOString(),
  };
  let inventoryRows = await repository.segmentInventory.list({ scheduleId: hold.scheduleId, seatNumber: { $in: seats }, segmentId: { $in: hold.segmentIds } }, { sort: { seatNumber: 1, segmentOrder: 1 }, limit: (seats.length * hold.segmentIds.length) + 10 });
  const staleSelectedHoldIds = unique(inventoryRows
    .filter((row) => row.status === 'held' && row.holdId && new Date(row.lockedUntil).getTime() <= timestamp.getTime())
    .map((row) => row.holdId));
  for (const staleHoldId of staleSelectedHoldIds) await releaseHold(staleHoldId, 'expired', 'checkout-targeted-expiry');
  if (staleSelectedHoldIds.length) {
    inventoryRows = await repository.segmentInventory.list({ scheduleId: hold.scheduleId, seatNumber: { $in: seats }, segmentId: { $in: hold.segmentIds } }, { sort: { seatNumber: 1, segmentOrder: 1 }, limit: (seats.length * hold.segmentIds.length) + 10 });
  }
  const expected = seats.length * hold.segmentIds.length;
  if (inventoryRows.length !== expected) throw conflictError('Seat inventory is incomplete; refresh the departure before booking', 'inventory_incomplete');
  const holdItemIds = await repository.nextIds('hold-item', inventoryRows.length);
  const holdItems = [];
  for (const [index, row] of inventoryRows.entries()) {
    holdItems.push({
      id: holdItemIds[index],
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
      const fresh = await repository.segmentInventory.list({ scheduleId: hold.scheduleId, seatNumber: { $in: seats }, segmentId: { $in: hold.segmentIds }, status: 'available' }, { session, sort: { seatNumber: 1, segmentOrder: 1 }, limit: expected + 10 });
      if (fresh.length !== expected) throw conflictError('One or more selected seats were just taken; choose again', 'seat_unavailable');
      for (const row of fresh) {
        row.status = 'held';
        row.holdId = hold.id;
        row.lockedUntil = expiresAt.toISOString();
        row.updatedAt = timestamp.toISOString();
      }
      // Keep transaction operations sequential. Mongoose explicitly does not
      // support parallel operations on the same transaction/session. The heavy
      // compatibility recount remains deferred after commit instead.
      await repository.holds.save(hold, { id: hold.id }, { session });
      await repository.holdItems.saveMany(holdItems, null, { session });
      await repository.segmentInventory.saveMany(fresh, null, { session });
      await repository.outbox({ eventType: 'BusInventoryHeld', aggregateType: 'inventory_hold', aggregateId: hold.id, companyId: hold.companyId, payload: { scheduleId: hold.scheduleId, seatNumbers: seats, segmentIds: hold.segmentIds, expiresAt: hold.expiresAt }, dedupeKey: `BusInventoryHeld:${hold.id}`, session });
      await repository.audit({ actorId: actorId(context.createdBy), action: 'bus.inventory.held', targetType: 'inventory_hold', targetId: hold.id, companyId: hold.companyId, metadata: { scheduleId: hold.scheduleId, seats, segmentIds: hold.segmentIds }, session });
    });
  } catch (error) {
    if (error.code === 11000) throw conflictError('One or more selected seats were just held by another traveler', 'seat_unavailable');
    throw error;
  }
  queueCompatibilityRefresh(hold.scheduleId, seats);
  return { ...hold, accessToken: token, seats: seats.map((seatNumber) => availableMap.get(seatNumber)), fare: availability.fare, journey: availability.journey };
}

async function assertActiveHold(holdId, token = '', session = null) {
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

async function consumeHold(holdId, { bookingId, bookingRef, bookingItemId, reservationId, assignments = [], tickets = [], actor = 'payment-settlement', session = null, deferCompatibilityRefresh = false } = {}) {
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
  if (!deferCompatibilityRefresh) {
    await recalculateCompatibilitySeats(hold.scheduleId, hold.seatNumbers || [hold.seatNumber], session);
    await recalculateScheduleAvailableSeats(hold.scheduleId, session);
  }
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
    await recalculateCompatibilitySeats(hold.scheduleId, hold.seatNumbers || [hold.seatNumber], activeSession);
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
  recalculateCompatibilitySeats,
  recalculateScheduleAvailableSeats,
  queueCompatibilityRefresh,
};

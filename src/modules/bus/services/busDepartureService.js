'use strict';

const repository = require('../repositories/busRepository');
const busSetupService = require('./busSetupService');
const { evaluateDriverAssignment, evaluateDriverEligibility } = require('../../../services/company/driverEligibilityService');
const {
  cleanText,
  normalize,
  numberValue,
  moneyValue,
  parseList,
  validationError,
  conflictError,
  notFoundError,
  parseDate,
  parseDurationMinutes,
  normalizeSeatNumber,
  sortStops,
  routeRange,
  calculateFare,
  assertDepartureTransition,
  immutableSnapshot,
} = require('../domain/busDomain');

const WEEKDAY_INDEX = Object.freeze({ sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 });
const MAX_BATCH_SCHEDULES = 180;
const MATERIALIZATION_BLOCKER_FIELDS = Object.freeze({
  materializationBlockedAt: '',
  materializationBlockedUntil: '',
  materializationBlockerCode: '',
  materializationBlockerReason: '',
  materializationBlockerFailures: '',
  materializationBlockerRuleIds: '',
  materializationRequiresAction: '',
  materializationStateUpdatedAt: '',
});

async function clearScheduleRuleMaterializationBlocker(companyId, ruleId) {
  await repository.scheduleRules.updateOne(
    { id: ruleId, companyId },
    { $unset: MATERIALIZATION_BLOCKER_FIELDS },
  );
}

async function clearDependentRecurringVehicleBlockers(companyId, changedRuleId) {
  const blockerId = cleanText(changedRuleId, 180);
  if (!companyId || !blockerId) return [];
  const filter = {
    companyId,
    materializationBlockerCode: { $in: ['vehicle_schedule_conflict', 'vehicle_schedule_conflict_window'] },
    materializationBlockerRuleIds: blockerId,
  };
  const dependents = await repository.scheduleRules.list(filter, { limit: 250 });
  if (!dependents.length) return [];
  await repository.scheduleRules.updateMany(
    filter,
    {
      $unset: MATERIALIZATION_BLOCKER_FIELDS,
      $set: { materializationStateUpdatedAt: nowIso() },
    },
  );
  const timestamp = nowIso();
  for (const dependent of dependents) {
    if (normalize(dependent.status) !== 'active') continue;
    // Requeue immediately when the rule that caused the conflict changes. This
    // avoids waiting for the periodic repair scan after an operator resolves it.
    // eslint-disable-next-line no-await-in-loop
    await repository.outbox({
      eventType: 'ScheduleRuleMaterializationRequested',
      aggregateType: 'schedule_rule',
      aggregateId: dependent.id,
      companyId,
      payload: { companyId, ruleId: dependent.id },
      dedupeKey: `ScheduleRuleMaterializationRequested:${dependent.id}:dependency-cleared:${blockerId}:${timestamp}`,
    });
  }
  return dependents.map((row) => row.id);
}

function nowIso() { return new Date().toISOString(); }
function actorId(value) { return cleanText(value || 'company-admin', 180); }

function complianceDocumentValid(reference, expiresAt, requiredAt) {
  const ref = cleanText(reference, 160);
  if (!ref || !expiresAt) return false;
  const expiry = new Date(expiresAt);
  const required = requiredAt instanceof Date && !Number.isNaN(requiredAt.getTime()) ? requiredAt : new Date();
  return !Number.isNaN(expiry.getTime()) && expiry.getTime() >= required.getTime();
}

function allowedWeekdaySet(days) {
  const result = new Set();
  parseList(days).forEach((day) => {
    const normalized = normalize(day);
    if (Object.prototype.hasOwnProperty.call(WEEKDAY_INDEX, normalized)) result.add(WEEKDAY_INDEX[normalized]);
    else if (/^[0-6]$/.test(String(day))) result.add(Number(day));
  });
  return result;
}

async function resolveDriver(companyId, value) {
  const id = cleanText(value, 220);
  if (!id) return null;
  const employee = await repository.employees.findOne({ companyId, $or: [{ id }, { userId: id }] });
  if (!employee) throw validationError('Select a saved driver record from this company');
  const user = employee.userId ? await repository.users.findOne({ id: employee.userId }) : null;
  if (user?.companyId && String(user.companyId) !== String(companyId)) {
    throw validationError('Selected driver account belongs to a different company');
  }
  const assignment = evaluateDriverAssignment(employee, user || {});
  if (!assignment.assignable) throw validationError('Selected company record is not configured as a driver');
  return {
    employee,
    user,
    assignment,
    operationalEligibility: evaluateDriverEligibility(employee, user || {}),
    name: cleanText(assignment.label || employee.roleTitle || employee.id, 180),
  };
}

async function routeContext(companyId, routeId) {
  const route = await repository.routeOrThrow(companyId, routeId);
  if (route.status !== 'active') throw validationError('Select an active route');
  const [listing, rawStops, segments] = await Promise.all([
    repository.listingOrThrow(companyId, route.listingId),
    repository.routeStops.list({ companyId, routeId: route.id, status: { $ne: 'archived' } }, { sort: { stopOrder: 1 } }),
    repository.routeSegments.list({ companyId, routeId: route.id, status: 'active' }, { sort: { segmentOrder: 1 } }),
  ]);
  const stops = sortStops(rawStops);
  if (stops.length < 2 || segments.length !== stops.length - 1) throw validationError('Route stops and route segments must be completed before creating a departure');
  return { route, listing, stops, segments };
}

async function vehicleContext(companyId, vehicleId, listingId) {
  let resolvedVehicleId = cleanText(vehicleId, 180);
  if (!resolvedVehicleId) {
    const candidates = await repository.vehicles.list({ companyId, listingId, status: 'active' }, { sort: { createdAt: 1 } });
    if (candidates.length === 1) resolvedVehicleId = candidates[0].id;
    else if (!candidates.length) throw validationError('Create and activate a vehicle for this bus service first');
    else throw validationError('Select the vehicle for this departure');
  }
  const vehicle = await repository.vehicleOrThrow(companyId, resolvedVehicleId);
  if (vehicle.status !== 'active') throw validationError('Selected vehicle must be active');
  if (vehicle.listingId && vehicle.listingId !== listingId) throw validationError('Selected vehicle belongs to a different bus service');
  const versionId = vehicle.activeSeatMapVersionId;
  if (!versionId) throw validationError('Publish a seat-map version for this vehicle first');
  const seatMapVersion = await repository.seatMapVersionOrThrow(companyId, versionId);
  if (seatMapVersion.status !== 'published') throw validationError('Selected vehicle seat map is not published');
  return { vehicle, seatMapVersion };
}

async function fareContext(companyId, fareProductId, route) {
  const productId = cleanText(fareProductId || route.activeFareProductId, 180);
  if (!productId) throw validationError('Select an active fare product');
  const fareProduct = await repository.fareProductOrThrow(companyId, productId);
  if (fareProduct.routeId !== route.id || fareProduct.status !== 'active') throw validationError('Selected fare product is not active for this route');
  const fares = await repository.segmentFares.list({ companyId, fareProductId: fareProduct.id, status: 'active' });
  if (!fares.length) throw validationError('Configure at least one route fare before creating a departure');
  return { fareProduct, fares };
}

async function scheduleCreationContext(companyId, payload = {}) {
  const [company, routeBundle] = await Promise.all([
    repository.companyOrThrow(companyId),
    routeContext(companyId, payload.routeId),
  ]);
  const { route, listing } = routeBundle;
  const [vehicleBundle, fareBundle, driver] = await Promise.all([
    vehicleContext(companyId, payload.vehicleId, listing.id),
    fareContext(companyId, payload.fareProductId, route),
    resolveDriver(companyId, payload.driverId || parseList(payload.driverIds)[0]),
  ]);
  return { company, ...routeBundle, ...vehicleBundle, ...fareBundle, driver };
}

function recurringRuleDays(days = []) {
  const normalized = [...allowedWeekdaySet(days)];
  return normalized.length ? normalized : [0, 1, 2, 3, 4, 5, 6];
}

function recurringRuleDateRange(rule = {}) {
  const start = new Date(rule.startDate || 0);
  const end = rule.endDate ? new Date(rule.endDate) : new Date('9999-12-31T23:59:59.999Z');
  return { start, end };
}

function recurringRuleTimeIntervals(rule = {}) {
  const [hours, minutes] = String(rule.departureTime || '00:00').split(':').map(Number);
  const minuteOfDay = Math.max(0, (Number(hours) || 0) * 60 + (Number(minutes) || 0));
  const duration = Math.max(1, Number(rule.durationMinutes || 24 * 60));
  const week = 7 * 24 * 60;
  return recurringRuleDays(rule.daysOfWeek).map((day) => {
    const start = day * 1440 + minuteOfDay;
    return { start, end: start + duration };
  }).flatMap((interval) => [interval, { start: interval.start - week, end: interval.end - week }, { start: interval.start + week, end: interval.end + week }]);
}

function recurringRulesOverlap(a = {}, b = {}) {
  const aRange = recurringRuleDateRange(a);
  const bRange = recurringRuleDateRange(b);
  if (aRange.end < bRange.start || bRange.end < aRange.start) return false;
  const aIntervals = recurringRuleTimeIntervals(a);
  const bIntervals = recurringRuleTimeIntervals(b);
  return aIntervals.some((left) => bIntervals.some((right) => left.start < right.end && right.start < left.end));
}

async function findRecurringVehicleRuleConflicts(companyId, candidate = {}, excludeRuleId = '') {
  if (normalize(candidate.status) !== 'active' || !candidate.vehicleId) return [];
  const rows = await repository.scheduleRules.list({
    companyId,
    vehicleId: candidate.vehicleId,
    status: 'active',
    ...(excludeRuleId ? { id: { $ne: excludeRuleId } } : {}),
  }, { sort: { createdAt: 1 }, limit: 250 });
  return rows.filter((rule) => recurringRulesOverlap(candidate, rule));
}

async function assertNoRecurringVehicleRuleConflict(companyId, candidate = {}, excludeRuleId = '') {
  const conflicts = await findRecurringVehicleRuleConflicts(companyId, candidate, excludeRuleId);
  if (!conflicts.length) return;
  const conflict = conflicts[0];
  throw conflictError(
    `This vehicle already has an overlapping active recurring rule (${conflict.id || 'existing rule'} at ${conflict.departureTime || 'another time'}). Choose another vehicle/time or pause the conflicting rule first.`,
    'vehicle_schedule_rule_conflict',
  );
}

async function findVehicleConflicts(companyId, vehicleId, departAt, arriveAt, excludeId = '') {
  const start = new Date(departAt);
  const end = arriveAt || new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const lookback = new Date(start.getTime() - (7 * 24 * 60 * 60 * 1000));
  const rows = await repository.schedules.list({
    companyId,
    vehicleId,
    ...(excludeId ? { id: { $ne: excludeId } } : {}),
    status: { $in: ['draft', 'active', 'published', 'boarding', 'delayed', 'departed'] },
    departAt: { $gt: lookback, $lt: end },
  }, { sort: { departAt: 1 }, limit: 250 });
  const startMs = new Date(departAt).getTime();
  const endMs = new Date(end).getTime();
  return rows.filter((row) => {
    const rowStart = new Date(row.departAt).getTime();
    const rowEnd = row.arriveAt ? new Date(row.arriveAt).getTime() : rowStart + 24 * 60 * 60 * 1000;
    return startMs < rowEnd && rowStart < endMs;
  });
}

function compatibilitySeatRow({ schedule, version, seat, timestamp, blockedSeatSet = new Set() }) {
  return {
    id: `seat-${schedule.id}-${seat.seatNumber}`,
    scheduleId: schedule.id,
    companyId: schedule.companyId,
    listingId: schedule.listingId,
    routeId: schedule.routeId,
    vehicleId: schedule.vehicleId,
    seatMapVersionId: version.id,
    source: 'seat_map_projection',
    seatNumber: seat.seatNumber,
    seatClass: seat.seatClass,
    seatType: seat.seatClass === 'VIP' ? 'vip' : seat.enabled === false ? 'disabled' : 'standard',
    priceDelta: Number(seat.priceDelta || 0),
    status: seat.enabled === false ? 'disabled' : blockedSeatSet.has(normalizeSeatNumber(seat.seatNumber)) ? 'blocked' : 'available',
    blockedReason: seat.blockedReason || (blockedSeatSet.has(normalizeSeatNumber(seat.seatNumber)) ? 'Blocked for this departure' : ''),
    lockedUntil: null,
    lockId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function generateInventory({
  schedule,
  routeSegments,
  seatMapVersion,
  blockedSeats = [],
  actor = 'system',
  session = null,
  replaceExisting = true,
  persistSchedule = true,
  auditInventory = true,
}) {
  const timestamp = nowIso();
  const requestedBlockedSeats = parseList(blockedSeats).map(normalizeSeatNumber);
  const knownSeatLabels = new Set(seatMapVersion.seats.map((seat) => normalizeSeatNumber(seat.seatNumber)));
  const unknownBlockedSeats = requestedBlockedSeats.filter((label) => !knownSeatLabels.has(label));
  if (unknownBlockedSeats.length) throw validationError(`Blocked seats are not in the selected vehicle seat map: ${unknownBlockedSeats.join(', ')}`);
  const blockedSeatSet = new Set(requestedBlockedSeats);
  const seats = seatMapVersion.seats.map((seat) => compatibilitySeatRow({ schedule, version: seatMapVersion, seat, timestamp, blockedSeatSet }));
  const inventory = [];
  for (const seat of seatMapVersion.seats) {
    for (const segment of routeSegments) {
      inventory.push({
        // This row already has a canonical unique identity. Allocating it through
        // MongoDB's counter one row at a time turned a 60-seat/10-segment bus into
        // 600 sequential writes before inventory could even be inserted.
        id: `bus-seat-segment:${schedule.id}:${seat.seatNumber}:${segment.id}`,
        companyId: schedule.companyId,
        listingId: schedule.listingId,
        routeId: schedule.routeId,
        scheduleId: schedule.id,
        vehicleId: schedule.vehicleId,
        seatMapVersionId: seatMapVersion.id,
        seatNumber: seat.seatNumber,
        seatClass: seat.seatClass,
        priceDelta: Number(seat.priceDelta || 0),
        segmentId: segment.id,
        segmentOrder: Number(segment.segmentOrder),
        fromStopId: segment.fromStopId,
        toStopId: segment.toStopId,
        status: seat.enabled === false ? 'disabled' : blockedSeatSet.has(normalizeSeatNumber(seat.seatNumber)) ? 'blocked' : 'available',
        blockedReason: seat.blockedReason || (blockedSeatSet.has(normalizeSeatNumber(seat.seatNumber)) ? 'Blocked for this departure' : ''),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
  }
  if (replaceExisting) {
    await Promise.all([
      repository.seats.deleteMany({ scheduleId: schedule.id }, session ? { session } : {}),
      repository.segmentInventory.deleteMany({ scheduleId: schedule.id }, session ? { session } : {}),
    ]);
  }
  if (seats.length) await repository.seats.saveMany(seats, null, session ? { session } : {});
  if (inventory.length) await repository.segmentInventory.saveMany(inventory, null, session ? { session } : {});
  const available = seats.filter((seat) => seat.status === 'available').length;
  schedule.totalSeats = seats.length;
  schedule.availableSeats = available;
  schedule.inventoryReadyAt = timestamp;
  schedule.seatInventorySnapshot = seats.map((seat) => ({ seatNumber: seat.seatNumber, seatClass: seat.seatClass, seatType: seat.seatType, priceDelta: seat.priceDelta, status: seat.status, blockedReason: seat.blockedReason }));
  if (persistSchedule) await repository.schedules.save(schedule, { id: schedule.id }, session ? { session } : {});
  if (auditInventory) await repository.audit({ actorId: actorId(actor), action: 'bus.departure.inventory_generated', targetType: 'trip_schedule', targetId: schedule.id, companyId: schedule.companyId, metadata: { seatCount: seats.length, segmentCount: routeSegments.length, inventoryRows: inventory.length }, session });
  return { seats, inventory };
}


function repairedSeatStatus(segmentRows = [], snapshotSeat = {}) {
  const states = segmentRows.map((row) => normalize(row.status));
  if (states.some((status) => ['checked_in', 'checked-in', 'no_show', 'no-show', 'booked', 'taken', 'sold', 'confirmed', 'occupied'].includes(status))) return 'taken';
  if (states.some((status) => ['held', 'reserved', 'locked'].includes(status))) return 'locked';
  if (states.some((status) => ['blocked', 'maintenance'].includes(status))) return 'blocked';
  if (snapshotSeat.enabled === false || states.some((status) => status === 'disabled')) return 'disabled';
  return 'available';
}

function inventoryRepairSnapshot(schedule = {}) {
  const seatSnapshot = schedule.seatMapSnapshot || {};
  const routeSnapshot = schedule.routeSnapshot || {};
  const seats = Array.isArray(seatSnapshot.seats) ? seatSnapshot.seats.filter((seat) => seat?.seatNumber) : [];
  const segments = Array.isArray(routeSnapshot.segments) ? routeSnapshot.segments.filter((segment) => segment?.id) : [];
  return {
    seatMapVersion: {
      ...seatSnapshot,
      id: seatSnapshot.versionId || schedule.seatMapVersionId,
      templateId: seatSnapshot.templateId || schedule.seatMapTemplateId,
      seats,
      totalSeats: Number(seatSnapshot.totalSeats || seats.length),
    },
    segments,
  };
}

function protectedPassengerState(row = {}) {
  return ['booked', 'taken', 'sold', 'confirmed', 'occupied', 'checked_in', 'checked-in', 'no_show', 'no-show', 'held', 'reserved', 'locked']
    .includes(normalize(row.status));
}

async function departureHasPassengerActivity(companyId, scheduleId, existingSeats = [], existingInventory = [], session = null) {
  const queryOptions = session ? { session } : {};
  const [reservation, assignment, ticket, hold] = await Promise.all([
    repository.reservations.findOne({ companyId, scheduleId, status: { $nin: ['cancelled', 'refunded', 'expired', 'released'] } }, queryOptions),
    repository.seatAssignments.findOne({ companyId, scheduleId, status: { $nin: ['cancelled', 'released', 'refunded'] } }, queryOptions),
    repository.tickets.findOne({ companyId, scheduleId, status: { $nin: ['void', 'cancelled', 'refunded'] } }, queryOptions),
    repository.holds.findOne({ companyId, scheduleId, status: 'active' }, queryOptions),
  ]);
  return Boolean(reservation || assignment || ticket || hold
    || existingInventory.some(protectedPassengerState)
    || existingSeats.some(protectedPassengerState));
}

function scheduleSeatMapSnapshot(version = {}, vehicle = {}) {
  return immutableSnapshot({
    versionId: version.id,
    templateId: version.templateId || vehicle.activeSeatMapTemplateId,
    version: version.version,
    checksum: version.checksum,
    vehicleClass: normalize(vehicle.vehicleClass || version.vehicleClass) === 'vip' ? 'vip' : 'standard',
    layoutName: version.layoutName,
    rows: version.rows,
    columns: version.columns,
    totalSeats: version.totalSeats,
    numberingStartSide: version.numberingStartSide || 'left',
    driverPosition: version.driverPosition || 'right',
    frontRowPassengerSeats: Number(version.frontRowPassengerSeats || 0) === 1 ? 1 : 0,
    rowLayoutOverrides: version.rowLayoutOverrides || [],
    seats: (version.seats || []).map((seat) => ({
      seatNumber: seat.seatNumber,
      displayLabel: seat.displayLabel || seat.seatNumber,
      row: seat.row,
      col: seat.col ?? seat.column,
      column: seat.column ?? seat.col,
      side: seat.side || '',
      deck: seat.deck || 'main',
      seatClass: seat.seatClass,
      seatType: seat.seatType,
      priceDelta: Number(seat.priceDelta || 0),
      enabled: seat.enabled !== false,
      blockedReason: seat.blockedReason || '',
    })),
  });
}

async function repairScheduleInventory(companyId, scheduleId, actor = 'company-admin') {
  let result;
  await repository.withTransaction(async (session) => {
    const schedule = await repository.scheduleOrThrow(companyId, scheduleId, { session });
    if (['archived', 'cancelled', 'completed', 'departed', 'arrived'].includes(normalize(schedule.status))) {
      throw conflictError('Only a future or active departure can have its seat inventory repaired', 'inventory_repair_status_conflict');
    }

    let { seatMapVersion, segments } = inventoryRepairSnapshot(schedule);
    if (!segments.length) {
      segments = await repository.routeSegments.list(
        { companyId, routeId: schedule.routeId, status: 'active' },
        { sort: { segmentOrder: 1 }, session },
      );
    }
    if (!segments.length) throw validationError('Complete this route\'s stops and segments before repairing seat inventory');

    const [existingSeats, existingInventory] = await Promise.all([
      repository.seats.list({ companyId, scheduleId: schedule.id }, { session, limit: 500 }),
      repository.segmentInventory.list({ companyId, scheduleId: schedule.id }, { session, limit: 20000 }),
    ]);

    const linkedVersion = schedule.seatMapVersionId
      ? await repository.seatMapVersions.findOne({ id: schedule.seatMapVersionId, companyId, vehicleId: schedule.vehicleId, status: 'published' }, { session })
      : null;
    let relinkedSeatMap = false;
    let vehicle = null;

    if (linkedVersion?.seats?.length) {
      seatMapVersion = linkedVersion;
    } else {
      vehicle = await repository.vehicles.findOne({ id: schedule.vehicleId, companyId, serviceType: 'bus' }, { session });
      const fallbackVersion = vehicle?.activeSeatMapVersionId
        ? await repository.seatMapVersions.findOne({
          id: vehicle.activeSeatMapVersionId,
          companyId,
          vehicleId: vehicle.id,
          status: 'published',
        }, { session })
        : null;
      if (!fallbackVersion?.seats?.length) {
        throw validationError('Publish a valid vehicle seat-map version before repairing this departure');
      }
      const passengerActivity = await departureHasPassengerActivity(companyId, schedule.id, existingSeats, existingInventory, session);
      if (passengerActivity) {
        throw conflictError('This departure has passenger activity, so its missing seat-map link cannot be replaced automatically. Resolve the affected booking or hold first, then retry.', 'inventory_repair_requires_manual_review');
      }
      seatMapVersion = fallbackVersion;
      relinkedSeatMap = true;
      schedule.seatMapVersionId = fallbackVersion.id;
      schedule.seatMapTemplateId = fallbackVersion.templateId || vehicle.activeSeatMapTemplateId;
      schedule.seatMapSnapshot = scheduleSeatMapSnapshot(fallbackVersion, vehicle);
    }

    if (!seatMapVersion?.id || !Array.isArray(seatMapVersion.seats) || !seatMapVersion.seats.length) {
      throw validationError('Publish a valid vehicle seat-map version before repairing this departure');
    }

    const expectedKeys = new Set();
    seatMapVersion.seats.forEach((seat) => segments.forEach((segment) => expectedKeys.add(`${normalizeSeatNumber(seat.seatNumber)}:${segment.id}`)));
    const inventoryKeys = new Set(existingInventory.map((row) => `${normalizeSeatNumber(row.seatNumber)}:${row.segmentId}`));
    const segmentInventoryComplete = !relinkedSeatMap && [...expectedKeys].every((key) => inventoryKeys.has(key));
    const existingSeatLabels = new Set(existingSeats.map((seat) => normalizeSeatNumber(seat.seatNumber)));
    const compatibilitySeatsComplete = !relinkedSeatMap && seatMapVersion.seats.every((seat) => existingSeatLabels.has(normalizeSeatNumber(seat.seatNumber)));

    let mode = relinkedSeatMap ? 'seat_map_relinked_and_inventory_rebuilt' : 'verified';
    let repairedSeats = existingSeats;
    let repairedInventory = existingInventory;

    if (segmentInventoryComplete && !compatibilitySeatsComplete) {
      const rowsBySeat = new Map();
      existingInventory.forEach((row) => {
        const label = normalizeSeatNumber(row.seatNumber);
        if (!rowsBySeat.has(label)) rowsBySeat.set(label, []);
        rowsBySeat.get(label).push(row);
      });
      const timestamp = nowIso();
      repairedSeats = seatMapVersion.seats.map((snapshotSeat) => {
        const row = compatibilitySeatRow({ schedule, version: seatMapVersion, seat: snapshotSeat, timestamp });
        row.status = repairedSeatStatus(rowsBySeat.get(normalizeSeatNumber(snapshotSeat.seatNumber)) || [], snapshotSeat);
        return row;
      });
      await repository.seats.deleteMany({ companyId, scheduleId: schedule.id }, { session });
      await repository.seats.saveMany(repairedSeats, null, { session });
      mode = 'compatibility_rows_rebuilt';
    } else if (!segmentInventoryComplete || relinkedSeatMap) {
      const passengerActivity = await departureHasPassengerActivity(companyId, schedule.id, existingSeats, existingInventory, session);
      if (passengerActivity) {
        throw conflictError('This departure has passenger activity, so its incomplete inventory cannot be rebuilt automatically. Resolve the affected booking or hold first, then retry.', 'inventory_repair_requires_manual_review');
      }
      const blockedSeats = [...new Set([
        ...seatMapVersion.seats.filter((seat) => seat.enabled === false || seat.blockedReason).map((seat) => seat.seatNumber),
        ...existingSeats.filter((seat) => ['blocked', 'disabled', 'maintenance'].includes(normalize(seat.status))).map((seat) => seat.seatNumber),
      ])];
      await Promise.all([
        repository.seats.deleteMany({ companyId, scheduleId: schedule.id }, { session }),
        repository.segmentInventory.deleteMany({ companyId, scheduleId: schedule.id }, { session }),
      ]);
      const generated = await generateInventory({
        schedule,
        routeSegments: segments,
        seatMapVersion,
        blockedSeats,
        actor,
        session,
        replaceExisting: false,
        persistSchedule: false,
        auditInventory: false,
      });
      repairedSeats = generated.seats;
      repairedInventory = generated.inventory;
      if (!relinkedSeatMap) mode = 'canonical_inventory_rebuilt';
    }

    const inventoryBySeat = new Map();
    repairedInventory.forEach((row) => {
      const label = normalizeSeatNumber(row.seatNumber);
      if (!inventoryBySeat.has(label)) inventoryBySeat.set(label, []);
      inventoryBySeat.get(label).push(row);
    });
    schedule.totalSeats = seatMapVersion.seats.length;
    schedule.availableSeats = seatMapVersion.seats.filter((seat) => {
      const rows = inventoryBySeat.get(normalizeSeatNumber(seat.seatNumber)) || [];
      return rows.length === segments.length && rows.every((row) => normalize(row.status) === 'available');
    }).length;
    schedule.inventoryReadyAt = nowIso();
    schedule.inventoryRepairedAt = schedule.inventoryReadyAt;
    schedule.inventoryRepairMode = mode;
    schedule.seatInventorySnapshot = repairedSeats.map((seat) => ({
      seatNumber: seat.seatNumber,
      seatClass: seat.seatClass,
      seatType: seat.seatType,
      priceDelta: Number(seat.priceDelta || 0),
      status: seat.status,
      blockedReason: seat.blockedReason || '',
    }));
    schedule.updatedBy = actorId(actor);
    schedule.updatedAt = schedule.inventoryReadyAt;
    await repository.schedules.save(schedule, { id: schedule.id }, { session });
    await repository.audit({
      actorId: actorId(actor),
      action: 'bus.departure.inventory_repaired',
      targetType: 'trip_schedule',
      targetId: schedule.id,
      companyId,
      metadata: {
        mode,
        relinkedSeatMap,
        seatMapVersionId: schedule.seatMapVersionId,
        seatCount: repairedSeats.length,
        segmentCount: segments.length,
        inventoryRows: repairedInventory.length,
      },
      session,
    });
    result = { schedule, mode, relinkedSeatMap, seatCount: repairedSeats.length, segmentCount: segments.length, inventoryRows: repairedInventory.length };
  });
  return result;
}

async function validateSchedulePublish(companyId, schedule = {}, known = {}) {
  const failures = [];
  const warnings = [];
  const routeId = schedule.routeId;
  const [
    company,
    route,
    vehicle,
    seatMapVersion,
    fareProduct,
    stops,
    segments,
    inventoryCount,
    driver,
  ] = await Promise.all([
    known.company || repository.companyOrThrow(companyId),
    known.route || repository.routes.findOne({ id: routeId, companyId }),
    known.vehicle || repository.vehicles.findOne({ id: schedule.vehicleId, companyId, serviceType: 'bus' }),
    known.seatMapVersion || repository.seatMapVersions.findOne({ id: schedule.seatMapVersionId, companyId, status: 'published' }),
    known.fareProduct || repository.fareProducts.findOne({ id: schedule.fareProductId, companyId, routeId, status: 'active' }),
    known.stops || (routeId ? repository.routeStops.list({ routeId, companyId, status: { $ne: 'archived' } }) : []),
    known.segments || (routeId ? repository.routeSegments.list({ routeId, companyId, status: 'active' }) : []),
    known.inventoryCount !== undefined
      ? known.inventoryCount
      : (schedule.id ? repository.segmentInventory.count({ scheduleId: schedule.id }) : 0),
    known.driver?.employee || (schedule.driverEmployeeId ? repository.employees.findOne({ id: schedule.driverEmployeeId, companyId }) : null),
  ]);
  const listing = known.listing || (route ? await repository.listings.findOne({ id: route.listingId, companyId, serviceType: 'bus' }) : null);
  const driverUser = known.driver?.user || (driver?.userId ? await repository.users.findOne({ id: driver.userId }) : null);
  const driverAssignment = evaluateDriverAssignment(driver || {}, driverUser || {});
  const driverOperational = evaluateDriverEligibility(driver || {}, driverUser || {});
  const driverReady = Boolean(driver) && driverAssignment.assignable;
  const departAt = schedule.departAt ? new Date(schedule.departAt) : null;
  const arriveAt = schedule.arriveAt ? new Date(schedule.arriveAt) : null;
  const conflicts = Array.isArray(known.conflicts)
    ? known.conflicts
    : (schedule.vehicleId && departAt ? await findVehicleConflicts(companyId, schedule.vehicleId, departAt, arriveAt, schedule.id) : []);

  if (company.status !== 'active' || company.verificationStatus !== 'verified') failures.push('company_not_active_and_verified');
  if (!listing || listing.status === 'archived') failures.push('bus_service_listing_missing');
  if (!route || route.status !== 'active') failures.push('route_not_active');
  if (stops.length < 2 || segments.length !== stops.length - 1) failures.push('route_segments_incomplete');
  if (!vehicle || vehicle.status !== 'active') failures.push('vehicle_not_active');
  if (vehicle && !complianceDocumentValid(vehicle.operatorPermitRef, vehicle.operatorPermitExpiresAt, departAt)) failures.push('operator_permit_missing_or_expired');
  if (vehicle && !complianceDocumentValid(vehicle.inspectionRef, vehicle.inspectionExpiresAt, departAt)) failures.push('inspection_missing_or_expired');
  if (vehicle && !complianceDocumentValid(vehicle.insuranceRef, vehicle.insuranceExpiresAt, departAt)) failures.push('insurance_missing_or_expired');
  if (!seatMapVersion) failures.push('published_seat_map_missing');
  if (!fareProduct) failures.push('active_fare_product_missing');
  if (!schedule.basePrice || Number(schedule.basePrice) <= 0) failures.push('fare_snapshot_missing');
  if (!schedule.currency) failures.push('currency_missing');
  if (!departAt || Number.isNaN(departAt.getTime())) failures.push('departure_time_missing');
  else if (departAt.getTime() <= Date.now()) failures.push('departure_must_be_future');
  if (arriveAt && departAt && arriveAt.getTime() <= departAt.getTime()) failures.push('arrival_must_be_after_departure');
  // Driver assignment is optional at publication time. Any saved company driver
  // can be assigned now or later; operational readiness remains a separate check.
  if (!inventoryCount) failures.push('seat_segment_inventory_missing');
  if (conflicts.length) failures.push('vehicle_time_conflict');
  if (!listing?.cancellationRules && !route?.cancellationRules) warnings.push('cancellation_policy_not_configured');
  return {
    ok: failures.length === 0,
    failures,
    warnings,
    checkedAt: nowIso(),
    summary: {
      companyVerified: company.verificationStatus === 'verified' && company.status === 'active',
      routeActive: route?.status === 'active',
      stopCount: stops.length,
      segmentCount: segments.length,
      vehicleActive: vehicle?.status === 'active',
      operatorPermitValid: !!vehicle && complianceDocumentValid(vehicle.operatorPermitRef, vehicle.operatorPermitExpiresAt, departAt),
      inspectionValid: !!vehicle && complianceDocumentValid(vehicle.inspectionRef, vehicle.inspectionExpiresAt, departAt),
      insuranceValid: !!vehicle && complianceDocumentValid(vehicle.insuranceRef, vehicle.insuranceExpiresAt, departAt),
      seatMapPublished: !!seatMapVersion,
      fareActive: !!fareProduct,
      inventoryRows: inventoryCount,
      driverAssigned: driverReady,
      driverOperational: driverOperational.eligible,
      driverWarnings: driverOperational.reasons,
      conflicts: conflicts.map((item) => item.id),
    },
  };
}

async function createSchedule(companyId, payload = {}, actor = 'company-admin', options = {}) {
  const context = options.context || await scheduleCreationContext(companyId, payload);
  const {
    company,
    route,
    listing,
    stops,
    segments,
    vehicle,
    seatMapVersion,
    fareProduct,
    fares,
    driver,
  } = context;
  const requestedStatus = normalize(payload.status || 'draft');
  const departAt = parseDate(payload.departAt, 'Departure time', { future: true });
  const routeDurationMinutes = Number(route.estimatedDurationMinutes || parseDurationMinutes(route.estimatedDuration, 0) || 0);
  const arriveAt = payload.arriveAt
    ? parseDate(payload.arriveAt, 'Arrival time')
    : routeDurationMinutes > 0
      ? new Date(departAt.getTime() + (routeDurationMinutes * 60_000))
      : null;
  if (arriveAt && arriveAt <= departAt) throw validationError('Arrival time must be after departure time');
  const boardingLeadMinutes = payload.boardingLeadMinutes == null || payload.boardingLeadMinutes === ''
    ? 30
    : numberValue(payload.boardingLeadMinutes, { field: 'Boarding lead time', min: 5, max: 360, integer: true });
  const boardingStartAt = payload.boardingStartAt
    ? parseDate(payload.boardingStartAt, 'Boarding start time')
    : new Date(departAt.getTime() - (boardingLeadMinutes * 60_000));
  if (boardingStartAt && boardingStartAt >= departAt) throw validationError('Boarding must start before departure');
  const conflicts = options.conflictsChecked
    ? []
    : await findVehicleConflicts(companyId, vehicle.id, departAt, arriveAt, cleanText(payload.replacesScheduleId, 180));
  if (conflicts.length) throw conflictError('Selected vehicle is already assigned to an overlapping departure', 'vehicle_schedule_conflict');
  const range = routeRange(stops, route.originStopId || stops[0].id, route.destinationStopId || stops[stops.length - 1].id);
  const fare = calculateFare({ fares, originStopId: range.origin.id, destinationStopId: range.destination.id, segments, range });
  const timestamp = nowIso();
  const schedule = {
    id: await repository.nextId('schedule'),
    serviceType: 'bus',
    inventoryType: 'seats',
    routeId: route.id,
    listingId: listing.id,
    companyId,
    vehicleId: vehicle.id,
    vehicleName: vehicle.name,
    vehicleClass: normalize(vehicle.vehicleClass || seatMapVersion.vehicleClass) === 'vip' ? 'vip' : 'standard',
    routeVersion: Number(route.version || 1),
    originStopId: range.origin.id,
    destinationStopId: range.destination.id,
    seatMapTemplateId: vehicle.activeSeatMapTemplateId,
    seatMapVersionId: seatMapVersion.id,
    fareProductId: fareProduct.id,
    routeSnapshot: immutableSnapshot({ routeId: route.id, routeName: route.routeName, routeCode: route.routeCode, version: route.version, timezone: route.timezone, origin: range.origin, destination: range.destination, stops, segments }),
    seatMapSnapshot: immutableSnapshot({
      versionId: seatMapVersion.id,
      templateId: seatMapVersion.templateId,
      version: seatMapVersion.version,
      checksum: seatMapVersion.checksum,
      vehicleClass: normalize(vehicle.vehicleClass || seatMapVersion.vehicleClass) === 'vip' ? 'vip' : 'standard',
      layoutName: seatMapVersion.layoutName,
      rows: seatMapVersion.rows,
      columns: seatMapVersion.columns,
      totalSeats: seatMapVersion.totalSeats,
      numberingStartSide: seatMapVersion.numberingStartSide || 'left',
      driverPosition: seatMapVersion.driverPosition || 'right',
      frontRowPassengerSeats: Number(seatMapVersion.frontRowPassengerSeats || 0) === 1 ? 1 : 0,
      rowLayoutOverrides: seatMapVersion.rowLayoutOverrides || [],
      seats: seatMapVersion.seats.map((seat) => ({
        seatNumber: seat.seatNumber,
        displayLabel: seat.displayLabel || seat.seatNumber,
        row: seat.row,
        col: seat.col,
        column: seat.column ?? seat.col,
        side: seat.side || '',
        deck: seat.deck || 'main',
        seatClass: seat.seatClass,
        seatType: seat.seatType,
        priceDelta: Number(seat.priceDelta || 0),
        enabled: seat.enabled !== false,
        blockedReason: seat.blockedReason || '',
      })),
    }),
    fareSnapshot: immutableSnapshot({
      fareProductId: fareProduct.id,
      name: fareProduct.name,
      fareClass: fareProduct.fareClass,
      currency: fareProduct.currency,
      refundable: fareProduct.refundable,
      changeable: fareProduct.changeable,
      baggageAllowanceKg: fareProduct.baggageAllowanceKg,
      baseFare: fare.amount,
      source: fare.source,
      fareIds: fare.fareIds,
      fares: fares.map((row) => ({
        id: row.id,
        fromStopId: row.fromStopId,
        toStopId: row.toStopId,
        fromOrder: Number(row.fromOrder),
        toOrder: Number(row.toOrder),
        amount: Number(row.amount),
        currency: row.currency || fareProduct.currency,
        status: row.status || 'active',
      })),
    }),
    driverName: driver?.name || '',
    driverIds: driver ? [driver.employee.id, driver.user?.id].filter(Boolean) : [],
    driverEmployeeId: driver?.employee?.id || '',
    driverUserId: driver?.user?.id || '',
    assignmentStatus: driver ? 'assigned' : 'unassigned',
    departAt: departAt.toISOString(),
    arriveAt: arriveAt?.toISOString() || null,
    boardingStartAt: boardingStartAt?.toISOString() || null,
    basePrice: fare.amount,
    currency: fareProduct.currency,
    fareClass: fareProduct.fareClass,
    gate: cleanText(payload.gate, 80),
    platform: cleanText(payload.platform, 80),
    notes: cleanText(payload.notes, 1600),
    totalSeats: seatMapVersion.totalSeats,
    availableSeats: 0,
    status: requestedStatus === 'active' ? 'active' : 'draft',
    scheduleRuleId: cleanText(payload.scheduleRuleId, 180),
    createdBy: actorId(actor),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  let generated;
  await repository.withTransaction(async (session) => {
    generated = await generateInventory({
      schedule,
      routeSegments: segments,
      seatMapVersion,
      blockedSeats: payload.blockedSeats,
      actor,
      session,
      replaceExisting: false,
      persistSchedule: false,
      auditInventory: options.auditInventory !== false,
    });
    schedule.publishValidation = await validateSchedulePublish(companyId, schedule, {
      company,
      route,
      listing,
      stops,
      segments,
      vehicle,
      seatMapVersion,
      fareProduct,
      driver,
      conflicts,
      inventoryCount: generated.inventory.length,
    });
    if (requestedStatus === 'published' && schedule.publishValidation.ok) {
      schedule.status = 'published';
      schedule.publishedAt = nowIso();
      schedule.updatedBy = actorId(actor);
      schedule.updatedAt = schedule.publishedAt;
    }
    await repository.schedules.save(schedule, { id: schedule.id }, { session });
    if (driver) {
      const assignment = {
        id: `driver-assignment:${schedule.id}:${driver.employee.id}:primary`,
        companyId,
        employeeId: driver.employee.id,
        driverUserId: driver.user?.id || '',
        vehicleId: vehicle.id,
        scheduleId: schedule.id,
        routeId: route.id,
        listingId: listing.id,
        assignmentType: 'schedule',
        assignmentRole: 'driver',
        startsAt: boardingStartAt?.toISOString() || departAt.toISOString(),
        endsAt: arriveAt?.toISOString() || null,
        safetyStatus: driver.employee.safetyStatus || 'not_submitted',
        status: 'active',
        note: cleanText(payload.driverNote, 600),
        assignedBy: actorId(actor),
        createdAt: timestamp,
      };
      await repository.driverAssignments.save(assignment, { id: assignment.id }, { session });
    }
    await repository.audit({ actorId: actorId(actor), action: 'bus.departure.created', targetType: 'trip_schedule', targetId: schedule.id, companyId, metadata: { routeId: route.id, vehicleId: vehicle.id, fareProductId: fareProduct.id, seatMapVersionId: seatMapVersion.id }, session });
    if (requestedStatus === 'published' && schedule.publishValidation.ok) {
      await repository.outbox({ eventType: 'BusDeparturePublished', aggregateType: 'trip_schedule', aggregateId: schedule.id, companyId, payload: { listingId: schedule.listingId, routeId: schedule.routeId, departAt: schedule.departAt }, dedupeKey: `BusDeparturePublished:${schedule.id}:${schedule.publishedAt}`, session });
      await repository.audit({ actorId: actorId(actor), action: 'bus.departure.published', targetType: 'trip_schedule', targetId: schedule.id, companyId, metadata: schedule.publishValidation.summary, session });
    }
  });
  const publicationDeferred = requestedStatus === 'published' && !schedule.publishValidation.ok
    ? {
      failures: schedule.publishValidation.failures,
      warnings: schedule.publishValidation.warnings,
      message: `Departure was saved as Draft because publishing still requires: ${schedule.publishValidation.failures.join(', ')}`,
    }
    : null;
  if (schedule.status === 'published' && !options.deferListingSync) {
    const listingPublication = await synchronizeListingPublicationAfterDeparture(companyId, schedule.listingId, actor);
    schedule.listingPublication = {
      published: Boolean(listingPublication.published),
      reason: listingPublication.reason,
      checkedAt: nowIso(),
      failures: listingPublication.readiness?.failures || (listingPublication.error ? [listingPublication.error] : []),
    };
    await repository.schedules.save(schedule, { id: schedule.id });
  }
  return { schedule, seats: generated.seats, segmentInventory: generated.inventory, publicationDeferred };
}

async function createScheduleBatch(companyId, payload = {}, actor = 'company-admin') {
  const start = parseDate(payload.departAt, 'Departure time', { future: true });
  const originalArrival = payload.arriveAt ? parseDate(payload.arriveAt, 'Arrival time') : null;
  const duration = originalArrival ? originalArrival.getTime() - start.getTime() : null;
  if (duration != null && duration <= 0) throw validationError('Arrival time must be after departure time');
  const until = payload.repeatUntil ? new Date(`${String(payload.repeatUntil).slice(0, 10)}T23:59:59`) : null;
  const weekdays = allowedWeekdaySet(payload.repeatDays);
  const dates = [];
  if (!until || Number.isNaN(until.getTime()) || until <= start) dates.push(start);
  else {
    let cursor = new Date(start);
    while (cursor <= until && dates.length < MAX_BATCH_SCHEDULES) {
      if (!weekdays.size || weekdays.has(cursor.getDay())) dates.push(new Date(cursor));
      cursor = new Date(cursor.getTime() + 86_400_000);
    }
  }
  if (!dates.length) throw validationError('No departure dates matched the repeat range');

  // Resolve the route, vehicle, seat map, fare, company, and driver once for the
  // whole date range. Previously the same records were reread for every day.
  const context = await scheduleCreationContext(companyId, payload);
  const routeDuration = Number(context.route.estimatedDurationMinutes || parseDurationMinutes(context.route.estimatedDuration, 0) || 0) * 60_000;
  const proposed = dates.map((departAt) => ({
    departAt,
    arriveAt: duration != null
      ? new Date(departAt.getTime() + duration)
      : (routeDuration > 0 ? new Date(departAt.getTime() + routeDuration) : null),
  }));
  const firstProposedAt = proposed[0].departAt;
  const lastProposedEnd = proposed.reduce((latest, item) => {
    const value = item.arriveAt || new Date(item.departAt.getTime() + 86_400_000);
    return value > latest ? value : latest;
  }, proposed[0].arriveAt || new Date(proposed[0].departAt.getTime() + 86_400_000));
  const existing = await repository.schedules.list({
    companyId,
    vehicleId: context.vehicle.id,
    status: { $in: ['draft', 'active', 'published', 'boarding', 'delayed', 'departed'] },
    departAt: {
      $gt: new Date(firstProposedAt.getTime() - (7 * 24 * 60 * 60 * 1000)),
      $lt: lastProposedEnd,
    },
  }, { sort: { departAt: 1 }, limit: 500 });
  const overlaps = (left, right) => {
    const leftStart = new Date(left.departAt).getTime();
    const rightStart = new Date(right.departAt).getTime();
    const leftEnd = left.arriveAt ? new Date(left.arriveAt).getTime() : leftStart + 86_400_000;
    const rightEnd = right.arriveAt ? new Date(right.arriveAt).getTime() : rightStart + 86_400_000;
    return leftStart < rightEnd && rightStart < leftEnd;
  };
  for (let index = 0; index < proposed.length; index += 1) {
    if (existing.some((row) => overlaps(proposed[index], row))) {
      throw conflictError('Selected vehicle is already assigned to an overlapping departure', 'vehicle_schedule_conflict');
    }
    if (proposed.slice(0, index).some((row) => overlaps(proposed[index], row))) {
      throw conflictError('The requested repeat range creates overlapping departures for the same vehicle', 'vehicle_schedule_conflict');
    }
  }

  const results = new Array(proposed.length);
  let cursor = 0;
  async function createNext() {
    while (cursor < proposed.length) {
      const index = cursor;
      cursor += 1;
      const item = proposed[index];
      results[index] = await createSchedule(companyId, {
        ...payload,
        departAt: item.departAt.toISOString(),
        arriveAt: item.arriveAt?.toISOString(),
        repeatUntil: undefined,
        repeatDays: undefined,
      }, actor, { context, conflictsChecked: true, deferListingSync: true, auditInventory: false });
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, proposed.length) }, createNext));
  const schedules = results.map((result) => result.schedule);

  // Publication readiness is listing-wide and was formerly recalculated once
  // per date. Reconcile it once after the complete batch is committed.
  const publishedSchedules = schedules.filter((schedule) => normalize(schedule.status) === 'published');
  if (publishedSchedules.length) {
    const publication = await synchronizeListingPublicationAfterDeparture(companyId, context.listing.id, actor);
    const checkedAt = nowIso();
    publishedSchedules.forEach((schedule) => {
      schedule.listingPublication = {
        published: Boolean(publication.published),
        reason: publication.reason,
        checkedAt,
        failures: publication.readiness?.failures || (publication.error ? [publication.error] : []),
      };
    });
    await repository.schedules.saveMany(publishedSchedules, (schedule) => ({ id: schedule.id }));
  }
  await repository.audit({
    actorId: actorId(actor),
    action: 'bus.departure.batch_inventory_generated',
    targetType: 'schedule_batch',
    targetId: schedules[0]?.scheduleRuleId || schedules[0]?.id || 'schedule-batch',
    companyId,
    metadata: {
      scheduleCount: schedules.length,
      seatRows: schedules.reduce((total, schedule) => total + Number(schedule.totalSeats || 0), 0),
      segmentRows: results.reduce((total, result) => total + Number(result.segmentInventory?.length || 0), 0),
    },
  });
  return {
    schedules,
    count: schedules.length,
    publishedCount: publishedSchedules.length,
    draftCount: schedules.length - publishedSchedules.length,
    publicationDeferred: results
      .map((result, index) => result.publicationDeferred ? {
        scheduleId: result.schedule.id,
        departAt: proposed[index].departAt.toISOString(),
        ...result.publicationDeferred,
      } : null)
      .filter(Boolean),
  };
}

async function createScheduleSeries(companyId, payloads = [], actor = 'company-admin') {
  const rows = (Array.isArray(payloads) ? payloads : []).filter(Boolean).slice(0, MAX_BATCH_SCHEDULES);
  if (!rows.length) return { results: [], count: 0, publishedCount: 0, draftCount: 0 };
  // Resolve company, route, vehicle, seat-map and fare once for repair batches.
  // Each date still performs its own vehicle-conflict check and transaction.
  const context = await scheduleCreationContext(companyId, rows[0]);
  const results = new Array(rows.length);
  let cursor = 0;
  async function createNext() {
    while (cursor < rows.length) {
      const index = cursor;
      cursor += 1;
      try {
        const result = await createSchedule(companyId, rows[index], actor, {
          context,
          deferListingSync: true,
          auditInventory: false,
        });
        results[index] = { ok: true, result };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, rows.length) }, createNext));
  const successful = results.filter((item) => item?.ok).map((item) => item.result);
  const publishedSchedules = successful.map((item) => item.schedule).filter((schedule) => normalize(schedule.status) === 'published');
  if (publishedSchedules.length) {
    const publication = await synchronizeListingPublicationAfterDeparture(companyId, context.listing.id, actor);
    const checkedAt = nowIso();
    publishedSchedules.forEach((schedule) => {
      schedule.listingPublication = {
        published: Boolean(publication.published),
        reason: publication.reason,
        checkedAt,
        failures: publication.readiness?.failures || (publication.error ? [publication.error] : []),
      };
    });
    await repository.schedules.saveMany(publishedSchedules, (schedule) => ({ id: schedule.id }));
  }
  return {
    results,
    count: successful.length,
    publishedCount: publishedSchedules.length,
    draftCount: successful.length - publishedSchedules.length,
  };
}

async function createScheduleRule(companyId, payload = {}, actor = 'company-admin') {
  const { route, listing } = await routeContext(companyId, payload.routeId);
  const { vehicle, seatMapVersion } = await vehicleContext(companyId, payload.vehicleId, listing.id);
  const { fareProduct } = await fareContext(companyId, payload.fareProductId, route);
  const departureTime = cleanText(payload.departureTime, 10);
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(departureTime)) throw validationError('Departure time must use HH:MM in 24-hour format');
  const startDate = parseDate(`${String(payload.startDate || new Date().toISOString()).slice(0, 10)}T00:00:00`, 'Start date');
  const endDate = payload.endDate ? parseDate(`${String(payload.endDate).slice(0, 10)}T23:59:59`, 'End date') : null;
  if (endDate && endDate < startDate) throw validationError('End date must be after start date');
  const requestedDriverId = payload.driverId || parseList(payload.driverIds)[0];
  const requestedStatus = normalize(payload.status || 'active');
  if (!['draft', 'active', 'paused'].includes(requestedStatus)) throw validationError('Recurring schedule status must be Draft, Active, or Paused');
  const driver = requestedDriverId ? await resolveDriver(companyId, requestedDriverId) : null;
  const blockedSeats = parseList(payload.blockedSeats).map(normalizeSeatNumber);
  const availableSeatLabels = new Set(seatMapVersion.seats.map((seat) => normalizeSeatNumber(seat.seatNumber)));
  const unknownBlockedSeats = blockedSeats.filter((label) => !availableSeatLabels.has(label));
  if (unknownBlockedSeats.length) throw validationError(`Blocked seats are not in the selected vehicle seat map: ${unknownBlockedSeats.join(', ')}`);
  const timestamp = nowIso();
  const rule = {
    id: await repository.nextId('schedule-rule'),
    companyId,
    listingId: listing.id,
    routeId: route.id,
    vehicleId: vehicle.id,
    seatMapTemplateId: vehicle.activeSeatMapTemplateId,
    seatMapVersionId: seatMapVersion.id,
    fareProductId: fareProduct.id,
    timezone: cleanText(payload.timezone || route.timezone || 'Africa/Kampala', 80),
    departureTime,
    daysOfWeek: [...allowedWeekdaySet(payload.daysOfWeek)],
    startDate: startDate.toISOString(),
    endDate: endDate?.toISOString() || null,
    durationMinutes: payload.durationMinutes
      ? numberValue(payload.durationMinutes, { field: 'Duration', min: 1, max: 100000, integer: true })
      : Number(route.estimatedDurationMinutes || parseDurationMinutes(route.estimatedDuration, 0) || 0) || null,
    basePrice: null,
    fareClass: fareProduct.fareClass,
    notes: cleanText(payload.notes, 1200),
    blockedSeats,
    driverIds: driver ? [driver.employee.id, driver.user?.id].filter(Boolean) : [],
    vipPriceDelta: 0,
    status: requestedStatus,
    createdBy: actorId(actor),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  if (requestedStatus === 'active') await assertNoRecurringVehicleRuleConflict(companyId, rule);
  await repository.scheduleRules.save(rule, { id: rule.id });
  await repository.audit({ actorId: actorId(actor), action: 'bus.schedule_rule.created', targetType: 'schedule_rule', targetId: rule.id, companyId, metadata: { routeId: route.id } });
  if (requestedStatus === 'active') {
    await repository.outbox({
      eventType: 'ScheduleRuleMaterializationRequested',
      aggregateType: 'schedule_rule',
      aggregateId: rule.id,
      companyId,
      payload: { companyId, ruleId: rule.id },
      dedupeKey: `ScheduleRuleMaterializationRequested:${rule.id}:${rule.createdAt}`,
    });
  }
  return rule;
}

async function updateScheduleRule(companyId, ruleId, payload = {}, actor = 'company-admin') {
  const rule = await repository.oneOrThrow(repository.scheduleRules, { id: ruleId, companyId }, 'Recurring schedule rule not found');
  if (normalize(rule.status) === 'cancelled') throw conflictError('Cancelled recurring schedule rules cannot be edited; create a replacement rule');

  const routeId = cleanText(payload.routeId || rule.routeId, 180);
  const vehicleId = cleanText(payload.vehicleId || rule.vehicleId, 180);
  const fareProductId = cleanText(payload.fareProductId || rule.fareProductId, 180);
  const { route, listing } = await routeContext(companyId, routeId);
  const { vehicle, seatMapVersion } = await vehicleContext(companyId, vehicleId, listing.id);
  const { fareProduct } = await fareContext(companyId, fareProductId, route);

  const departureTime = cleanText(payload.departureTime || rule.departureTime, 10);
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(departureTime)) throw validationError('Departure time must use HH:MM in 24-hour format');
  const startSource = Object.prototype.hasOwnProperty.call(payload, 'startDate') ? payload.startDate : rule.startDate;
  const endSource = Object.prototype.hasOwnProperty.call(payload, 'endDate') ? payload.endDate : rule.endDate;
  const startDate = parseDate(`${String(startSource || new Date().toISOString()).slice(0, 10)}T00:00:00`, 'Start date');
  const endDate = endSource ? parseDate(`${String(endSource).slice(0, 10)}T23:59:59`, 'End date') : null;
  if (endDate && endDate < startDate) throw validationError('End date must be after start date');

  const requestedDriverId = Object.prototype.hasOwnProperty.call(payload, 'driverId')
    ? payload.driverId
    : (parseList(rule.driverIds)[0] || '');
  const driver = requestedDriverId ? await resolveDriver(companyId, requestedDriverId) : null;
  const requestedStatus = normalize(payload.status || rule.status || 'active');
  if (!['draft', 'active', 'paused'].includes(requestedStatus)) throw validationError('Recurring schedule status must be Draft, Active, or Paused');

  const blockedSeats = Object.prototype.hasOwnProperty.call(payload, 'blockedSeats')
    ? parseList(payload.blockedSeats).map(normalizeSeatNumber)
    : parseList(rule.blockedSeats).map(normalizeSeatNumber);
  const availableSeatLabels = new Set((seatMapVersion.seats || []).map((seat) => normalizeSeatNumber(seat.seatNumber)));
  const unknownBlockedSeats = blockedSeats.filter((label) => !availableSeatLabels.has(label));
  if (unknownBlockedSeats.length) throw validationError(`Blocked seats are not in the selected vehicle seat map: ${unknownBlockedSeats.join(', ')}`);

  rule.listingId = listing.id;
  rule.routeId = route.id;
  rule.vehicleId = vehicle.id;
  rule.seatMapTemplateId = vehicle.activeSeatMapTemplateId;
  rule.seatMapVersionId = seatMapVersion.id;
  rule.fareProductId = fareProduct.id;
  rule.timezone = cleanText(payload.timezone || rule.timezone || route.timezone || 'Africa/Kampala', 80);
  rule.departureTime = departureTime;
  rule.daysOfWeek = Object.prototype.hasOwnProperty.call(payload, 'daysOfWeek')
    ? [...allowedWeekdaySet(payload.daysOfWeek)]
    : [...allowedWeekdaySet(rule.daysOfWeek)];
  rule.startDate = startDate.toISOString();
  rule.endDate = endDate?.toISOString() || null;
  rule.durationMinutes = Object.prototype.hasOwnProperty.call(payload, 'durationMinutes') && payload.durationMinutes !== ''
    ? numberValue(payload.durationMinutes, { field: 'Duration', min: 1, max: 100000, integer: true })
    : Number(rule.durationMinutes || route.estimatedDurationMinutes || parseDurationMinutes(route.estimatedDuration, 0) || 0) || null;
  rule.fareClass = fareProduct.fareClass;
  rule.notes = Object.prototype.hasOwnProperty.call(payload, 'notes') ? cleanText(payload.notes, 1200) : cleanText(rule.notes, 1200);
  rule.blockedSeats = blockedSeats;
  rule.driverIds = driver ? [driver.employee.id, driver.user?.id].filter(Boolean) : [];
  rule.vipPriceDelta = 0;
  rule.status = requestedStatus;
  rule.updatedBy = actorId(actor);
  rule.updatedAt = nowIso();
  if (requestedStatus === 'active') await assertNoRecurringVehicleRuleConflict(companyId, rule, rule.id);
  await repository.scheduleRules.save(rule, { id: rule.id });
  await clearScheduleRuleMaterializationBlocker(companyId, rule.id);
  await clearDependentRecurringVehicleBlockers(companyId, rule.id);
  await repository.audit({ actorId: actorId(actor), action: 'bus.schedule_rule.updated', targetType: 'schedule_rule', targetId: rule.id, companyId, metadata: { routeId: route.id, status: requestedStatus } });
  if (requestedStatus === 'active') {
    await repository.outbox({
      eventType: 'ScheduleRuleMaterializationRequested',
      aggregateType: 'schedule_rule',
      aggregateId: rule.id,
      companyId,
      payload: { companyId, ruleId: rule.id },
      dedupeKey: `ScheduleRuleMaterializationRequested:${rule.id}:${rule.updatedAt}`,
    });
  }
  return rule;
}

async function setScheduleRuleStatus(companyId, ruleId, status, actor = 'company-admin') {
  const rule = await repository.oneOrThrow(repository.scheduleRules, { id: ruleId, companyId }, 'Recurring schedule rule not found');
  const next = normalize(status);
  if (!['active', 'paused', 'cancelled'].includes(next)) throw validationError('Invalid recurring schedule rule status');
  if (next === 'active') {
    const driverIds = parseList(rule.driverIds);
    if (driverIds.length) await resolveDriver(companyId, driverIds[0]);
    await assertNoRecurringVehicleRuleConflict(companyId, { ...rule, status: 'active' }, rule.id);
  }
  rule.status = next;
  rule.updatedBy = actorId(actor);
  rule.updatedAt = nowIso();
  await repository.scheduleRules.save(rule, { id: rule.id });
  await clearScheduleRuleMaterializationBlocker(companyId, rule.id);
  await clearDependentRecurringVehicleBlockers(companyId, rule.id);
  await repository.audit({ actorId: actorId(actor), action: 'bus.schedule_rule.status_updated', targetType: 'schedule_rule', targetId: rule.id, companyId, metadata: { status: next } });
  if (next === 'active') {
    await repository.outbox({
      eventType: 'ScheduleRuleMaterializationRequested',
      aggregateType: 'schedule_rule',
      aggregateId: rule.id,
      companyId,
      payload: { companyId, ruleId: rule.id },
      dedupeKey: `ScheduleRuleMaterializationRequested:${rule.id}:${rule.updatedAt}`,
    });
  }
  return rule;
}

function pauseScheduleRule(companyId, ruleId, actor) { return setScheduleRuleStatus(companyId, ruleId, 'paused', actor); }
function resumeScheduleRule(companyId, ruleId, actor) { return setScheduleRuleStatus(companyId, ruleId, 'active', actor); }
function cancelScheduleRule(companyId, ruleId, actor) { return setScheduleRuleStatus(companyId, ruleId, 'cancelled', actor); }

async function recordScheduleRuleMaterialization(companyId, ruleId, throughDate, actor = 'system') {
  await repository.oneOrThrow(repository.scheduleRules, { id: ruleId, companyId }, 'Recurring schedule rule not found');
  const materializedThrough = parseDate(throughDate, 'Materialization date').toISOString();
  await repository.scheduleRules.updateOne({ id: ruleId, companyId }, {
    $max: { materializedThrough },
    $set: { materializedBy: actorId(actor), materializationStateUpdatedAt: nowIso() },
  });
  return repository.oneOrThrow(repository.scheduleRules, { id: ruleId, companyId }, 'Recurring schedule rule not found');
}

async function updateSchedule(companyId, scheduleId, payload = {}, actor = 'company-admin') {
  const schedule = await repository.scheduleOrThrow(companyId, scheduleId);
  if (!['draft', 'active'].includes(schedule.status)) throw conflictError('Published or started departures cannot change route, vehicle, fare or seat map; create a replacement departure');

  const requestedStatus = normalize(payload.status || schedule.status || 'draft');
  if (!['draft', 'active', 'published'].includes(requestedStatus)) {
    throw validationError('Departure status must be Draft, Active, or Published');
  }

  const merged = {
    ...schedule,
    ...payload,
    routeId: payload.routeId || schedule.routeId,
    vehicleId: payload.vehicleId || schedule.vehicleId,
    fareProductId: payload.fareProductId || schedule.fareProductId,
    driverId: Object.prototype.hasOwnProperty.call(payload, 'driverId') ? payload.driverId : schedule.driverEmployeeId,
    departAt: payload.departAt || schedule.departAt,
    arriveAt: Object.prototype.hasOwnProperty.call(payload, 'arriveAt') ? payload.arriveAt : schedule.arriveAt,
    boardingStartAt: Object.prototype.hasOwnProperty.call(payload, 'boardingStartAt') ? payload.boardingStartAt : schedule.boardingStartAt,
    status: requestedStatus,
    replacesScheduleId: schedule.id,
  };

  // Build and validate the replacement first. The original departure is left untouched
  // when any driver, inventory, compliance, fare, or publication validation fails.
  const replacement = await createSchedule(companyId, merged, actor);
  replacement.schedule.replacesScheduleId = schedule.id;
  await repository.schedules.save(replacement.schedule, { id: replacement.schedule.id });

  schedule.status = 'archived';
  schedule.replacedByScheduleId = replacement.schedule.id;
  schedule.updatedBy = actorId(actor);
  schedule.updatedAt = nowIso();
  await repository.withTransaction(async (session) => {
    await repository.schedules.save(schedule, { id: schedule.id }, { session });
    await repository.seats.deleteMany({ scheduleId: schedule.id }, { session });
    await repository.segmentInventory.deleteMany({ scheduleId: schedule.id }, { session });
    await repository.driverAssignments.deleteMany({ scheduleId: schedule.id }, { session });
    await repository.audit({
      actorId: actorId(actor),
      action: 'bus.departure.replaced',
      targetType: 'trip_schedule',
      targetId: replacement.schedule.id,
      companyId,
      metadata: { replacedScheduleId: schedule.id, requestedStatus },
      session,
    });
  });
  return repository.scheduleOrThrow(companyId, replacement.schedule.id);
}


async function synchronizeListingPublicationAfterDeparture(companyId, listingId, actor = 'company-admin') {
  const listing = await repository.listings.findOne({ id: listingId, companyId, serviceType: 'bus' });
  if (!listing || ['archived', 'deleted'].includes(normalize(listing.status))) {
    return { published: false, reason: 'listing_missing_or_archived' };
  }
  try {
    const readiness = await busSetupService.listingReadiness(companyId, listing.id);
    const alreadyPublished = normalize(listing.status) === 'active'
      && ['published', 'live'].includes(normalize(listing.releaseStatus));

    listing.publication = {
      readiness: readiness.ok ? 'bookable' : 'incomplete',
      bookingReadiness: readiness.ok ? 'ready' : 'incomplete',
      public: alreadyPublished && readiness.ok,
      state: alreadyPublished && readiness.ok ? 'published' : normalize(listing.status || 'draft'),
      lastCheckedAt: readiness.checkedAt,
      failures: readiness.failures,
      bookingFailures: readiness.failures,
      counts: readiness.counts,
      departureDiagnostics: readiness.departureDiagnostics,
    };

    // Publishing a departure completes readiness, but never bypasses the operator's explicit
    // listing activation action. This keeps the workflow deterministic and auditable.
    if (alreadyPublished && !readiness.ok) {
      // A temporary inventory gap must not erase an operator's public service
      // from the marketplace. Preserve publication and disable booking until a
      // valid future departure is published.
      listing.bookable = false;
      listing.publication.public = false;
      listing.publication.state = 'published';
    } else if (alreadyPublished && readiness.ok) {
      listing.bookable = true;
    } else {
      listing.bookable = false;
    }
    listing.updatedBy = actorId(actor);
    listing.updatedAt = nowIso();
    await repository.listings.save(listing, { id: listing.id });
    return {
      published: alreadyPublished && readiness.ok,
      reason: readiness.ok ? 'ready_for_manual_activation' : 'listing_not_ready',
      readiness,
    };
  } catch (error) {
    listing.publication = {
      ...(listing.publication || {}),
      readiness: 'incomplete',
      bookingReadiness: 'incomplete',
      public: false,
      lastCheckedAt: nowIso(),
      failures: [cleanText(error.message || 'Listing readiness synchronization failed', 600)],
    };
    listing.bookable = false;
    listing.updatedAt = nowIso();
    await repository.listings.save(listing, { id: listing.id });
    return { published: false, reason: 'readiness_sync_failed', error: error.message || String(error) };
  }
}

async function publishSchedule(companyId, scheduleId, actor = 'company-admin', options = {}) {
  let schedule = options.schedule || await repository.scheduleOrThrow(companyId, scheduleId);
  if (!['draft', 'active'].includes(schedule.status)) throw conflictError('Only draft or active departures can be published');
  let validation = options.validation || await validateSchedulePublish(companyId, schedule);
  if (validation.failures.some((failure) => ['seat_segment_inventory_missing', 'published_seat_map_missing'].includes(failure))) {
    try {
      await repairScheduleInventory(companyId, schedule.id, actor);
      schedule = await repository.scheduleOrThrow(companyId, schedule.id);
      validation = await validateSchedulePublish(companyId, schedule);
    } catch (repairError) {
      if (repairError?.code !== 'inventory_repair_requires_manual_review') throw repairError;
    }
  }
  schedule.publishValidation = validation;
  if (!validation.ok) {
    await repository.schedules.save(schedule, { id: schedule.id });
    throw Object.assign(validationError(`Departure cannot be published: ${validation.failures.join(', ')}`), { validation });
  }
  schedule.status = 'published';
  schedule.publishedAt = nowIso();
  schedule.updatedBy = actorId(actor);
  schedule.updatedAt = schedule.publishedAt;
  await repository.withTransaction(async (session) => {
    await repository.schedules.save(schedule, { id: schedule.id }, { session });
    await repository.outbox({ eventType: 'BusDeparturePublished', aggregateType: 'trip_schedule', aggregateId: schedule.id, companyId, payload: { listingId: schedule.listingId, routeId: schedule.routeId, departAt: schedule.departAt }, dedupeKey: `BusDeparturePublished:${schedule.id}:${schedule.publishedAt}`, session });
    await repository.audit({ actorId: actorId(actor), action: 'bus.departure.published', targetType: 'trip_schedule', targetId: schedule.id, companyId, metadata: validation.summary, session });
  });
  if (options.deferListingSync) return schedule;
  const listingPublication = await synchronizeListingPublicationAfterDeparture(companyId, schedule.listingId, actor);
  schedule.listingPublication = {
    published: Boolean(listingPublication.published),
    reason: listingPublication.reason,
    checkedAt: nowIso(),
    failures: listingPublication.readiness?.failures || (listingPublication.error ? [listingPublication.error] : []),
  };
  await repository.schedules.save(schedule, { id: schedule.id });
  return schedule;
}

async function transitionSchedule(companyId, scheduleId, payload = {}, actor = 'company-admin') {
  const schedule = await repository.scheduleOrThrow(companyId, scheduleId);
  const next = normalize(payload.status || payload.nextStatus);
  if (next === 'published') return publishSchedule(companyId, scheduleId, actor);
  assertDepartureTransition(schedule.status, next);
  const timestamp = nowIso();
  schedule.status = next;
  schedule.statusReason = cleanText(payload.reason || payload.note, 1000);
  schedule.updatedBy = actorId(actor);
  schedule.updatedAt = timestamp;
  if (next === 'completed') schedule.completedAt = timestamp;
  if (next === 'departed') schedule.actualDepartedAt = timestamp;
  if (next === 'arrived') schedule.actualArrivedAt = timestamp;
  await repository.withTransaction(async (session) => {
    await repository.schedules.save(schedule, { id: schedule.id }, { session });
    const update = { id: await repository.nextId('trip-status'), companyId, scheduleId: schedule.id, vehicleId: schedule.vehicleId, status: next, location: cleanText(payload.location, 300), note: schedule.statusReason, createdBy: actorId(actor), createdAt: timestamp };
    await repository.tripStatusUpdates.save(update, { id: update.id }, { session });
    await repository.outbox({ eventType: `BusDeparture${next.split('_').map((x) => x[0].toUpperCase() + x.slice(1)).join('')}`, aggregateType: 'trip_schedule', aggregateId: schedule.id, companyId, payload: { scheduleId: schedule.id, status: next, reason: schedule.statusReason }, dedupeKey: `BusDepartureStatus:${schedule.id}:${next}:${timestamp}`, session });
    if (schedule.scheduleRuleId && ['departed', 'arrived', 'completed', 'cancelled', 'archived'].includes(next)) {
      await repository.outbox({
        eventType: 'ScheduleRuleMaterializationRequested',
        aggregateType: 'schedule_rule',
        aggregateId: schedule.scheduleRuleId,
        companyId,
        payload: { companyId, ruleId: schedule.scheduleRuleId },
        dedupeKey: `ScheduleRuleMaterializationRequested:${schedule.scheduleRuleId}:departure-${schedule.id}:${next}:${timestamp}`,
        session,
      });
    }
    await repository.audit({ actorId: actorId(actor), action: 'bus.departure.status_updated', targetType: 'trip_schedule', targetId: schedule.id, companyId, metadata: { status: next }, session });
  });
  return schedule;
}

async function completeSchedule(companyId, scheduleId, payload = {}, actor = 'company-admin') {
  const schedule = await repository.scheduleOrThrow(companyId, scheduleId);
  if (schedule.status === 'arrived') await transitionSchedule(companyId, schedule.id, { ...payload, status: 'completed' }, actor);
  else if (schedule.status !== 'completed') throw conflictError('A departure must be marked arrived before completion');
  const timestamp = nowIso();
  const reservations = await repository.reservations.list({ companyId, scheduleId, status: { $in: ['confirmed', 'boarding', 'departed'] } });
  for (const reservation of reservations) {
    reservation.status = 'completed';
    reservation.updatedAt = timestamp;
  }
  if (reservations.length) await repository.reservations.saveMany(reservations);
  const bookingIds = [...new Set(reservations.map((item) => item.bookingId))];
  const bookings = bookingIds.length ? await repository.bookings.list({ id: { $in: bookingIds }, companyId }) : [];
  for (const booking of bookings) {
    booking.bookingStatus = 'completed';
    booking.completedAt = timestamp;
    booking.completedBy = actorId(actor);
  }
  if (bookings.length) await repository.bookings.saveMany(bookings);
  // Existing commission release remains the platform settlement integration.
  try {
    const releaseService = require('../../../services/commission/releaseService');
    for (const booking of bookings) await releaseService.releaseCompletedBooking(booking.bookingRef);
  } catch (_) { /* settlement recovery job can retry from canonical completed status */ }
  await repository.audit({ actorId: actorId(actor), action: 'bus.departure.completed', targetType: 'trip_schedule', targetId: schedule.id, companyId, metadata: { completedReservations: reservations.length, completedBookings: bookings.length } });
  return { schedule: await repository.scheduleOrThrow(companyId, schedule.id), reservations, bookings };
}

async function archiveSchedule(companyId, scheduleId, actor = 'company-admin') {
  const schedule = await repository.scheduleOrThrow(companyId, scheduleId);
  if (!['draft', 'active', 'cancelled', 'completed'].includes(schedule.status)) throw conflictError('Only draft, cancelled or completed departures can be archived');
  if (schedule.status !== 'archived') {
    if (!['cancelled', 'completed'].includes(schedule.status)) schedule.status = 'archived';
    else assertDepartureTransition(schedule.status, 'archived');
    schedule.status = 'archived';
  }
  schedule.updatedBy = actorId(actor);
  schedule.updatedAt = nowIso();
  await repository.schedules.save(schedule, { id: schedule.id });
  return schedule;
}

async function duplicateSchedule(companyId, scheduleId, payload = {}, actor = 'company-admin') {
  const original = await repository.scheduleOrThrow(companyId, scheduleId);
  const originalDeparture = new Date(original.departAt);
  const originalArrival = original.arriveAt ? new Date(original.arriveAt) : null;
  const duration = originalArrival ? originalArrival.getTime() - originalDeparture.getTime() : null;
  const departAt = payload.departAt ? parseDate(payload.departAt, 'Departure time', { future: true }) : new Date(Date.now() + 86_400_000);
  return (await createSchedule(companyId, {
    routeId: payload.routeId || original.routeId,
    vehicleId: payload.vehicleId || original.vehicleId,
    fareProductId: payload.fareProductId || original.fareProductId,
    driverId: payload.driverId || original.driverEmployeeId,
    departAt: departAt.toISOString(),
    arriveAt: payload.arriveAt || (duration == null ? undefined : new Date(departAt.getTime() + duration).toISOString()),
    boardingStartAt: payload.boardingStartAt,
    gate: payload.gate || original.gate,
    platform: payload.platform || original.platform,
    notes: payload.notes || `Duplicated from ${original.id}`,
    status: payload.status || 'draft',
  }, actor)).schedule;
}

async function updateSeatStatus(companyId, payload = {}, actor = 'company-admin') {
  const schedule = await repository.scheduleOrThrow(companyId, payload.scheduleId);
  const seatNumber = cleanText(payload.seatNumber, 20).toUpperCase();
  const seat = await repository.seats.findOne({ scheduleId: schedule.id, seatNumber });
  if (!seat) throw validationError('Seat not found for this departure', 404);
  const next = normalize(payload.status || '');
  const map = { held: 'held', locked: 'held', booked: 'booked', taken: 'booked', available: 'available', blocked: 'blocked', maintenance: 'blocked', disabled: 'disabled', cancelled: 'cancelled', refunded: 'refunded', checked_in: 'checked_in', no_show: 'no_show' };
  if (!map[next]) throw validationError('Invalid seat operational status');
  if (['held', 'booked', 'checked_in', 'no_show', 'cancelled', 'refunded'].includes(map[next])) throw conflictError('Booking-controlled seat states cannot be changed manually');
  const existing = await repository.segmentInventory.list({ scheduleId: schedule.id, seatNumber });
  if (existing.some((row) => ['held', 'booked', 'checked_in', 'no_show'].includes(row.status))) throw conflictError('This seat has active holds or reservations and cannot be changed manually');
  const timestamp = nowIso();
  seat.status = map[next] === 'blocked' ? 'blocked' : map[next];
  seat.blockedReason = cleanText(payload.blockedReason || payload.reason, 600);
  seat.updatedAt = timestamp;
  for (const row of existing) {
    row.status = map[next];
    row.blockedReason = seat.blockedReason;
    row.updatedAt = timestamp;
  }
  await repository.withTransaction(async (session) => {
    await repository.seats.save(seat, { scheduleId: schedule.id, seatNumber }, { session });
    if (existing.length) await repository.segmentInventory.saveMany(existing, null, { session });
    await recalculateAvailability(schedule, session);
    await repository.audit({ actorId: actorId(actor), action: 'bus.departure.seat_status_updated', targetType: 'seat', targetId: seat.id, companyId, metadata: { scheduleId: schedule.id, seatNumber, status: map[next] }, session });
  });
  return { seat, schedule: await repository.scheduleOrThrow(companyId, schedule.id) };
}

async function recalculateAvailability(schedule, session = null) {
  const rows = await repository.segmentInventory.list({ scheduleId: schedule.id }, session ? { session } : {});
  const bySeat = new Map();
  for (const row of rows) {
    if (!bySeat.has(row.seatNumber)) bySeat.set(row.seatNumber, []);
    bySeat.get(row.seatNumber).push(row);
  }
  schedule.availableSeats = [...bySeat.values()].filter((items) => items.every((item) => item.status === 'available')).length;
  schedule.updatedAt = nowIso();
  await repository.schedules.save(schedule, { id: schedule.id }, session ? { session } : {});
  return schedule.availableSeats;
}

module.exports = {
  resolveDriver,
  allowedWeekdaySet,
  routeContext,
  vehicleContext,
  fareContext,
  findVehicleConflicts,
  generateInventory,
  repairScheduleInventory,
  validateSchedulePublish,
  createSchedule,
  createScheduleBatch,
  createScheduleSeries,
  createScheduleRule,
  updateScheduleRule,
  pauseScheduleRule,
  resumeScheduleRule,
  cancelScheduleRule,
  recordScheduleRuleMaterialization,
  updateSchedule,
  publishSchedule,
  transitionSchedule,
  completeSchedule,
  archiveSchedule,
  duplicateSchedule,
  updateSeatStatus,
  recalculateAvailability,
};

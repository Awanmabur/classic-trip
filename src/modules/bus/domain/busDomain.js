'use strict';

const crypto = require('crypto');

const DEPARTURE_TRANSITIONS = Object.freeze({
  draft: ['active', 'published', 'cancelled', 'archived'],
  active: ['published', 'cancelled', 'archived'],
  published: ['boarding', 'delayed', 'cancelled'],
  delayed: ['boarding', 'departed', 'cancelled'],
  boarding: ['departed', 'delayed', 'cancelled'],
  departed: ['arrived'],
  arrived: ['completed'],
  completed: ['archived'],
  cancelled: ['archived'],
  archived: [],
});


const BUS_LISTING_STATUSES = Object.freeze(['draft', 'active', 'paused', 'archived']);

const RESERVATION_TRANSITIONS = Object.freeze({
  holding_inventory: ['awaiting_payment', 'expired', 'failed', 'cancelled'],
  awaiting_payment: ['confirmed', 'expired', 'failed', 'cancelled'],
  confirmed: ['boarding', 'cancellation_pending', 'cancelled', 'disputed'],
  boarding: ['departed', 'cancelled', 'disputed'],
  departed: ['completed', 'disputed'],
  completed: ['disputed'],
  cancellation_pending: ['cancelled', 'confirmed', 'disputed'],
  cancelled: [],
  expired: [],
  failed: [],
  disputed: ['completed', 'cancelled'],
});

function cleanText(value, maxLength = 1000) {
  return String(value == null ? '' : value)
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalize(value) {
  return cleanText(value, 200).toLowerCase().replace(/[\s-]+/g, '_');
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if ([true, 1, '1', 'true', 'on', 'yes'].includes(value)) return true;
  if ([false, 0, '0', 'false', 'off', 'no'].includes(value)) return false;
  return fallback;
}

function numberValue(value, { field = 'value', min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY, integer = false, fallback } = {}) {
  if ((value === undefined || value === null || value === '') && fallback !== undefined) return fallback;
  const result = Number(value);
  if (!Number.isFinite(result)) throw validationError(`${field} must be a valid number`);
  const normalized = integer ? Math.round(result) : result;
  if (normalized < min || normalized > max) throw validationError(`${field} must be between ${min} and ${max}`);
  return normalized;
}

function moneyValue(value, field = 'amount', fallback) {
  return numberValue(value, { field, min: 0, max: 1_000_000_000_000, fallback });
}

function parseList(value) {
  if (Array.isArray(value)) return value.map((item) => cleanText(item, 180)).filter(Boolean);
  if (value == null || value === '') return [];
  return String(value).split(/[\n,;]+/).map((item) => cleanText(item, 180)).filter(Boolean);
}

function unique(values = []) {
  return [...new Set(values.map((value) => cleanText(value, 180)).filter(Boolean))];
}

function validationError(message, status = 422, code = 'validation_error') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function notFoundError(message) {
  return validationError(message, 404, 'not_found');
}

function conflictError(message, code = 'conflict') {
  return validationError(message, 409, code);
}

function canonicalBusListingStatus(value) {
  const status = normalize(value);
  if (!BUS_LISTING_STATUSES.includes(status)) throw validationError('Invalid bus listing status');
  return status;
}

function applyBusListingPrivateStatus(listing = {}, statusValue, { actor = 'company-admin', at = new Date().toISOString() } = {}) {
  const status = canonicalBusListingStatus(statusValue);
  if (status === 'active') throw validationError('Active bus listings must pass publication readiness checks');
  listing.status = status;
  listing.releaseStatus = status;
  listing.bookable = false;
  listing.updatedBy = cleanText(actor, 180);
  listing.updatedAt = at;
  listing.publication = {
    ...(listing.publication && typeof listing.publication === 'object' ? listing.publication : {}),
    public: false,
    state: status,
    lastStatusChangeAt: at,
  };
  if (status === 'archived') listing.archivedAt = at;
  if (status === 'paused') listing.pausedAt = at;
  if (status === 'draft') listing.unpublishedAt = at;
  return listing;
}

function applyBusListingPublishedStatus(listing = {}, readiness = {}, { actor = 'company-admin', at = new Date().toISOString() } = {}) {
  if (readiness.ok !== true || readiness.bookingReady !== true) {
    throw validationError('Active bus listings require a valid future published dated departure');
  }
  listing.status = 'active';
  listing.releaseStatus = 'published';
  listing.bookable = true;
  listing.isVerified = true;
  listing.publishedAt = listing.publishedAt || at;
  listing.updatedBy = cleanText(actor, 180);
  listing.updatedAt = at;
  listing.publication = {
    readiness: 'bookable',
    bookingReadiness: 'ready',
    public: true,
    state: 'published',
    lastCheckedAt: readiness.checkedAt || at,
    failures: [],
    bookingFailures: [],
    counts: readiness.counts || {},
    lastStatusChangeAt: at,
  };
  return listing;
}

function requireText(value, field, maxLength = 180) {
  const result = cleanText(value, maxLength);
  if (!result) throw validationError(`${field} is required`);
  return result;
}

function parseDate(value, field, { future = false } = {}) {
  const date = value instanceof Date ? value : new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw validationError(`${field} must be a valid date and time`);
  if (future && date.getTime() <= Date.now()) throw validationError(`${field} must be in the future`);
  return date;
}

function parseDurationMinutes(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (Number.isFinite(Number(value))) return Math.max(0, Math.round(Number(value)));
  const text = cleanText(value, 120).toLowerCase();
  if (!text) return fallback;
  const clock = text.match(/^(\d{1,3}):([0-5]\d)$/);
  if (clock) return (Number(clock[1]) * 60) + Number(clock[2]);
  let minutes = 0;
  const days = text.match(/(\d+(?:\.\d+)?)\s*(?:d|day|days)\b/);
  const hours = text.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/);
  const mins = text.match(/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/);
  if (days) minutes += Number(days[1]) * 1440;
  if (hours) minutes += Number(hours[1]) * 60;
  if (mins) minutes += Number(mins[1]);
  return minutes > 0 ? Math.round(minutes) : fallback;
}

function normalizeSeatNumber(value) {
  return requireText(value, 'Seat number', 20).toUpperCase().replace(/\s+/g, '');
}

function columnsForLayout(layoutName = '2x2') {
  const normalized = normalize(layoutName);
  const map = {
    '1x1': 2,
    '1x2': 3,
    '2x1': 3,
    '2x2': 4,
    '2x3': 5,
    '3x2': 5,
    '3x3': 6,
  };
  return map[normalized] || Math.max(1, Number(String(layoutName).split('x').reduce((sum, item) => sum + (Number(item) || 0), 0)) || 4);
}

function inferSeatType(column, columns) {
  if (column === 1 || column === columns) return 'window';
  if (columns <= 2) return 'aisle';
  if (column === Math.ceil(columns / 2) || column === Math.floor(columns / 2) + 1) return 'aisle';
  return 'middle';
}

function spreadsheetColumnLabel(index) {
  let value = Math.max(1, Number(index) || 1);
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function generatedSeatLabels({ mode = 'automatic', totalSeats, columns, prefix = '' } = {}) {
  const normalizedMode = normalize(mode || 'automatic');
  const safePrefix = cleanText(prefix, 8).toUpperCase().replace(/\s+/g, '');
  return Array.from({ length: totalSeats }, (_, index) => {
    if (normalizedMode === 'row_letters' || normalizedMode === 'row_letter') {
      const row = Math.floor(index / columns) + 1;
      const column = (index % columns) + 1;
      return `${spreadsheetColumnLabel(row)}${column}`;
    }
    if (normalizedMode === 'prefix_numeric' || normalizedMode === 'prefix') return `${safePrefix || 'S'}${index + 1}`;
    return String(index + 1);
  });
}

function normalizeSpecialSeatList(values, label, availableLabels) {
  const normalized = parseList(values).map(normalizeSeatNumber);
  const duplicates = normalized.filter((value, index) => normalized.indexOf(value) !== index);
  if (duplicates.length) throw validationError(`${label} contains duplicate seat labels: ${unique(duplicates).join(', ')}`);
  const available = new Set(availableLabels);
  const unknown = normalized.filter((value) => !available.has(value));
  if (unknown.length) throw validationError(`${label} contains seats that are not in this seat map: ${unique(unknown).join(', ')}`);
  return new Set(normalized);
}

function buildSeatDefinitions({
  totalSeats,
  rows,
  columns,
  layoutName = '2x2',
  labels = [],
  labelMode = '',
  labelPrefix = '',
  vipSeats = [],
  accessibleSeats = [],
  crewSeats = [],
  disabledSeats = [],
  blockedSeats = [],
  vipPriceDelta = 0,
} = {}) {
  const rawLabels = parseList(labels).map((value) => normalizeSeatNumber(value));
  const duplicateLabels = rawLabels.filter((value, index) => rawLabels.indexOf(value) !== index);
  if (duplicateLabels.length) throw validationError(`Seat labels must be unique. Duplicates: ${unique(duplicateLabels).join(', ')}`);
  const requestedLabelMode = normalize(labelMode || (rawLabels.length ? 'custom' : 'automatic'));
  const normalizedLabelMode = ['automatic', 'numeric', 'row_letters', 'prefix_numeric', 'custom', 'preserve'].includes(requestedLabelMode)
    ? requestedLabelMode
    : 'automatic';
  const resolvedColumns = columns == null || columns === ''
    ? columnsForLayout(layoutName)
    : numberValue(columns, { field: 'Seat columns', min: 1, max: 12, integer: true });
  const requestedTotal = numberValue(
    totalSeats == null || totalSeats === '' ? rawLabels.length : totalSeats,
    { field: 'Total seats', min: 1, max: 300, integer: true },
  );
  const resolvedRows = rows == null || rows === ''
    ? Math.ceil(requestedTotal / resolvedColumns)
    : numberValue(rows, { field: 'Seat rows', min: 1, max: 100, integer: true });
  if (resolvedRows * resolvedColumns < requestedTotal) throw validationError('Rows and columns do not have enough positions for the total seats');

  let customLabels = [];
  if (['custom', 'preserve'].includes(normalizedLabelMode)) {
    customLabels = rawLabels;
    if (customLabels.length !== requestedTotal) {
      throw validationError(`Custom seat labels contain ${customLabels.length} label(s), but this bus has ${requestedTotal} seat positions. Use automatic numbering or provide exactly ${requestedTotal} unique labels.`);
    }
  } else if (!labelMode && rawLabels.length && rawLabels.length !== requestedTotal && rawLabels.every((value) => /^\d+$/.test(value))) {
    // Backward-compatible recovery for older forms that submitted only some numeric labels.
    // Preserve those labels and safely fill the remaining positions with unused numbers.
    const used = new Set(rawLabels);
    customLabels = [...rawLabels];
    for (let value = 1; customLabels.length < requestedTotal; value += 1) {
      const label = String(value);
      if (!used.has(label)) { customLabels.push(label); used.add(label); }
    }
  } else if (!labelMode && rawLabels.length === requestedTotal) {
    customLabels = rawLabels;
  } else {
    customLabels = generatedSeatLabels({ mode: normalizedLabelMode, totalSeats: requestedTotal, columns: resolvedColumns, prefix: labelPrefix });
  }

  const vip = normalizeSpecialSeatList(vipSeats, 'VIP seats', customLabels);
  const accessible = normalizeSpecialSeatList(accessibleSeats, 'Accessible seats', customLabels);
  const crew = normalizeSpecialSeatList(crewSeats, 'Crew seats', customLabels);
  const disabled = normalizeSpecialSeatList(disabledSeats, 'Disabled seats', customLabels);
  const blocked = normalizeSpecialSeatList(blockedSeats, 'Blocked seats', customLabels);
  const passengerCategoryConflicts = [...crew].filter((seat) => vip.has(seat) || accessible.has(seat));
  if (passengerCategoryConflicts.length) throw validationError(`Crew-only seats cannot also be passenger-category seats: ${passengerCategoryConflicts.join(', ')}`);
  const disabledCategoryConflicts = [...disabled].filter((seat) => vip.has(seat) || accessible.has(seat) || crew.has(seat));
  if (disabledCategoryConflicts.length) throw validationError(`Non-sellable spaces cannot also be assigned a passenger or crew category: ${disabledCategoryConflicts.join(', ')}`);
  const delta = moneyValue(vipPriceDelta, 'VIP price difference', 0);

  const seats = [];
  for (let index = 0; index < requestedTotal; index += 1) {
    const seatNumber = customLabels[index] || String(index + 1);
    const row = Math.floor(index / resolvedColumns) + 1;
    const column = (index % resolvedColumns) + 1;
    let seatClass = 'Standard';
    let seatType = inferSeatType(column, resolvedColumns);
    let priceDelta = 0;
    if (vip.has(seatNumber)) { seatClass = 'VIP'; priceDelta = delta; }
    if (accessible.has(seatNumber)) { seatClass = 'Accessible'; seatType = 'accessible'; }
    if (crew.has(seatNumber)) { seatClass = 'Crew'; seatType = 'crew'; }
    seats.push({
      seatNumber,
      row,
      column,
      deck: 'lower',
      seatClass,
      seatType,
      priceDelta,
      accessible: accessible.has(seatNumber),
      enabled: !blocked.has(seatNumber) && !crew.has(seatNumber) && !disabled.has(seatNumber),
      blockedReason: blocked.has(seatNumber)
        ? 'Blocked in seat-map version'
        : crew.has(seatNumber)
          ? 'Reserved for crew'
          : disabled.has(seatNumber)
            ? 'Disabled/non-passenger seat position'
            : '',
    });
  }
  return {
    rows: resolvedRows,
    columns: resolvedColumns,
    totalSeats: requestedTotal,
    labelMode: normalizedLabelMode,
    labelPrefix: cleanText(labelPrefix, 8).toUpperCase().replace(/\s+/g, ''),
    seats,
  };
}

function seatMapChecksum(value = {}) {
  const normalized = {
    layoutName: cleanText(value.layoutName, 40),
    rows: Number(value.rows || 0),
    columns: Number(value.columns || 0),
    totalSeats: Number(value.totalSeats || 0),
    seats: (value.seats || []).map((seat) => ({
      seatNumber: normalizeSeatNumber(seat.seatNumber),
      row: Number(seat.row),
      column: Number(seat.column),
      seatClass: seat.seatClass,
      seatType: seat.seatType,
      priceDelta: Number(seat.priceDelta || 0),
      enabled: seat.enabled !== false,
    })).sort((a, b) => a.seatNumber.localeCompare(b.seatNumber, undefined, { numeric: true })),
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function sortStops(stops = []) {
  return stops
    .filter((stop) => stop && normalize(stop.status || 'active') !== 'archived')
    .slice()
    .sort((a, b) => Number(a.stopOrder || 0) - Number(b.stopOrder || 0));
}

function validateOrderedStops(stops = []) {
  const ordered = sortStops(stops);
  if (ordered.length < 2) throw validationError('A bus route requires at least an origin and destination stop');
  const seenIds = new Set();
  const seenOrders = new Set();
  for (const stop of ordered) {
    const id = requireText(stop.id, 'Route stop ID', 180);
    if (seenIds.has(id)) throw validationError('A route cannot contain the same stop more than once');
    const order = numberValue(stop.stopOrder, { field: 'Stop order', min: 0, max: 1000, integer: true });
    if (seenOrders.has(order)) throw validationError('Every active route stop must have a unique order');
    seenIds.add(id);
    seenOrders.add(order);
  }
  if (!ordered[0].pickupAllowed && normalize(ordered[0].stopType) !== 'origin') throw validationError('The first route stop must allow pickup');
  if (!ordered[ordered.length - 1].dropoffAllowed && normalize(ordered[ordered.length - 1].stopType) !== 'destination') throw validationError('The last route stop must allow drop-off');
  return ordered;
}

function buildRouteSegments(stops = []) {
  const ordered = validateOrderedStops(stops);
  return ordered.slice(0, -1).map((fromStop, segmentOrder) => {
    const toStop = ordered[segmentOrder + 1];
    return {
      fromStopId: fromStop.id,
      toStopId: toStop.id,
      fromOrder: Number(fromStop.stopOrder),
      toOrder: Number(toStop.stopOrder),
      segmentOrder,
      distanceKm: Math.max(0, Number(toStop.distanceFromPreviousKm || 0)),
      durationMinutes: Math.max(0, Number(toStop.timeFromPreviousMinutes || toStop.timeOffsetMinutes || 0)),
    };
  });
}

function routeRange(stops = [], originStopId, destinationStopId) {
  const ordered = validateOrderedStops(stops);
  const originIndex = ordered.findIndex((stop) => String(stop.id) === String(originStopId));
  const destinationIndex = ordered.findIndex((stop) => String(stop.id) === String(destinationStopId));
  if (originIndex < 0) throw validationError('Selected boarding stop does not belong to this route');
  if (destinationIndex < 0) throw validationError('Selected drop-off stop does not belong to this route');
  if (destinationIndex <= originIndex) throw validationError('Drop-off stop must come after the boarding stop');
  const origin = ordered[originIndex];
  const destination = ordered[destinationIndex];
  if (origin.pickupAllowed === false) throw validationError('Pickup is not allowed at the selected boarding stop');
  if (destination.dropoffAllowed === false) throw validationError('Drop-off is not allowed at the selected destination stop');
  return {
    origin,
    destination,
    originIndex,
    destinationIndex,
    originOrder: Number(origin.stopOrder),
    destinationOrder: Number(destination.stopOrder),
    segmentCount: destinationIndex - originIndex,
    totalStopCount: ordered.length,
  };
}

function requiredSegments(segments = [], range = {}) {
  const selected = segments
    .filter((segment) => Number(segment.fromOrder) >= Number(range.originOrder)
      && Number(segment.toOrder) <= Number(range.destinationOrder))
    .sort((a, b) => Number(a.segmentOrder) - Number(b.segmentOrder));
  if (selected.length !== Number(range.segmentCount)) throw validationError('Route segment configuration is incomplete for the selected journey');
  return selected;
}

function rangesOverlap(leftStart, leftEnd, rightStart, rightEnd) {
  return Number(leftStart) < Number(rightEnd) && Number(rightStart) < Number(leftEnd);
}

function assignmentOverlaps(left = {}, right = {}) {
  return rangesOverlap(left.originOrder, left.destinationOrder, right.originOrder, right.destinationOrder);
}

function calculateFare({ fares = [], originStopId, destinationStopId, segments = [], range, fallbackAmount } = {}) {
  const active = fares.filter((fare) => ['active', 'published'].includes(normalize(fare.status || 'active')));
  const exact = active.find((fare) => String(fare.fromStopId) === String(originStopId)
    && String(fare.toStopId) === String(destinationStopId));
  if (exact) return { amount: moneyValue(exact.amount, 'Fare amount'), source: 'exact', fareIds: [exact.id].filter(Boolean) };

  // Validate that the route itself is continuous before evaluating configured
  // fare bands. A fare may cover one physical route segment or several stops.
  requiredSegments(segments, range);
  const originOrder = Number(range.originOrder);
  const destinationOrder = Number(range.destinationOrder);
  const edgesByOrigin = new Map();
  active.forEach((fare) => {
    const fromOrder = Number(fare.fromOrder);
    const toOrder = Number(fare.toOrder);
    if (!Number.isFinite(fromOrder) || !Number.isFinite(toOrder)) return;
    if (fromOrder < originOrder || toOrder > destinationOrder || toOrder <= fromOrder) return;
    if (!edgesByOrigin.has(fromOrder)) edgesByOrigin.set(fromOrder, []);
    edgesByOrigin.get(fromOrder).push(fare);
  });

  // Prefer the path with the fewest configured fare bands. This lets an admin
  // enter Kampala→Gulu and Gulu→Adjumani without defining a price for every
  // minor stop, while an exact Kampala→Adjumani fare still wins above.
  const best = new Map([[originOrder, { amount: 0, fares: [] }]]);
  for (let order = originOrder; order < destinationOrder; order += 1) {
    const current = best.get(order);
    if (!current) continue;
    for (const fare of edgesByOrigin.get(order) || []) {
      const nextOrder = Number(fare.toOrder);
      const candidate = {
        amount: current.amount + moneyValue(fare.amount, 'Fare amount'),
        fares: [...current.fares, fare],
      };
      const existing = best.get(nextOrder);
      const better = !existing
        || candidate.fares.length < existing.fares.length
        || (candidate.fares.length === existing.fares.length && candidate.amount < existing.amount);
      if (better) best.set(nextOrder, candidate);
    }
  }

  const configuredPath = best.get(destinationOrder);
  if (configuredPath?.fares?.length) {
    const adjacentOnly = configuredPath.fares.every((fare) => Number(fare.toOrder) - Number(fare.fromOrder) === 1);
    return {
      amount: configuredPath.amount,
      source: adjacentOnly ? 'segment_sum' : 'configured_fare_path',
      fareIds: configuredPath.fares.map((fare) => fare.id).filter(Boolean),
    };
  }

  // A valid route pair must never be blocked only because the partner has not
  // configured every stop combination. Reuse the configured end-to-end fare
  // when available; otherwise use the departure's server-owned base fare.
  const routeStartOrder = Math.min(...segments.map((segment) => Number(segment.fromOrder)).filter(Number.isFinite));
  const routeEndOrder = Math.max(...segments.map((segment) => Number(segment.toOrder)).filter(Number.isFinite));
  const directRouteFare = active.find((fare) => Number(fare.fromOrder) === routeStartOrder
    && Number(fare.toOrder) === routeEndOrder);
  if (directRouteFare) {
    return {
      amount: moneyValue(directRouteFare.amount, 'Direct route fare'),
      source: 'direct_route_fare_fallback',
      fareIds: [directRouteFare.id].filter(Boolean),
    };
  }
  if (fallbackAmount !== undefined) {
    return { amount: moneyValue(fallbackAmount, 'Fallback fare'), source: 'schedule_base_fare_fallback', fareIds: [] };
  }
  throw validationError('This departure has no usable fare configured');
}

function assertTransition(current, next, map, label) {
  const from = normalize(current);
  const to = normalize(next);
  if (!map[from]) throw validationError(`Unknown ${label} status: ${current}`);
  if (!map[from].includes(to)) throw conflictError(`${label} cannot move from ${from} to ${to}`, 'invalid_status_transition');
  return to;
}

function assertDepartureTransition(current, next) {
  return assertTransition(current, next, DEPARTURE_TRANSITIONS, 'Departure');
}

function assertReservationTransition(current, next) {
  return assertTransition(current, next, RESERVATION_TRANSITIONS, 'Bus reservation');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function hashToken(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function tokenPreview(value) {
  const text = String(value || '');
  return text ? `${text.slice(0, 6)}…${text.slice(-4)}` : '';
}

function publicId(prefix = 'bus') {
  return `${prefix}_${crypto.randomBytes(10).toString('hex')}`;
}

function immutableSnapshot(value) {
  return JSON.parse(JSON.stringify(value == null ? null : value));
}

module.exports = {
  DEPARTURE_TRANSITIONS,
  RESERVATION_TRANSITIONS,
  BUS_LISTING_STATUSES,
  cleanText,
  normalize,
  boolValue,
  numberValue,
  moneyValue,
  parseList,
  unique,
  validationError,
  notFoundError,
  conflictError,
  canonicalBusListingStatus,
  applyBusListingPrivateStatus,
  applyBusListingPublishedStatus,
  requireText,
  parseDate,
  parseDurationMinutes,
  normalizeSeatNumber,
  columnsForLayout,
  buildSeatDefinitions,
  seatMapChecksum,
  sortStops,
  validateOrderedStops,
  buildRouteSegments,
  routeRange,
  requiredSegments,
  rangesOverlap,
  assignmentOverlaps,
  calculateFare,
  assertDepartureTransition,
  assertReservationTransition,
  randomToken,
  hashToken,
  tokenPreview,
  publicId,
  immutableSnapshot,
};

'use strict';

const repository = require('../repositories/busRepository');
const { cleanText, normalize, locationMatches } = require('../domain/busDomain');

function scheduleVehicleClass(schedule = {}) {
  if (normalize(schedule.vehicleClass) === 'vip') return 'vip';
  if (normalize(schedule.seatMapSnapshot?.vehicleClass) === 'vip') return 'vip';
  return (schedule.seatMapSnapshot?.seats || []).some((seat) => normalize(seat.seatClass) === 'vip') ? 'vip' : 'standard';
}

function stopMatches(stop, wantedBranchId, wantedName) {
  const wantedBranch = cleanText(wantedBranchId, 180);
  const candidateBranch = cleanText(stop?.branchId, 180);
  const branchMatches = wantedBranch && candidateBranch && candidateBranch === wantedBranch;
  const nameMatches = wantedName && locationMatches(stop?.name, wantedName);
  // Branch identity is authoritative when available. Name matching keeps older
  // manually-created routes usable when their stops pre-date branch linkage.
  return Boolean(branchMatches || nameMatches);
}

function scheduleTravelBounds(schedule = {}, route = {}, stops = []) {
  if (!stops.length) return { first: 0, last: -1 };
  const originId = cleanText(schedule.originStopId || route.originStopId, 180);
  const destinationId = cleanText(schedule.destinationStopId || route.destinationStopId, 180);
  const originIndex = originId ? stops.findIndex((stop) => String(stop.id || '') === originId) : 0;
  const destinationIndex = destinationId ? stops.findIndex((stop) => String(stop.id || '') === destinationId) : stops.length - 1;
  // Legacy schedules may not have endpoint snapshots. In that case use the
  // complete ordered route rather than hiding an otherwise valid departure.
  if (originIndex < 0 || destinationIndex <= originIndex) return { first: 0, last: stops.length - 1 };
  return { first: originIndex, last: destinationIndex };
}

function journeyForSchedule(schedule = {}, route = {}, stops = [], wanted = {}) {
  const bounds = scheduleTravelBounds(schedule, route, stops);
  if (bounds.last < bounds.first) return null;
  const traversed = stops.slice(bounds.first, bounds.last + 1);
  const originOffset = traversed.findIndex((stop) => (
    stop.pickupAllowed !== false
    && stopMatches(stop, wanted.originBranchId, wanted.originName)
  ));
  if (originOffset < 0) return null;
  const destinationOffset = traversed.findIndex((stop, index) => (
    index > originOffset
    && stop.dropoffAllowed !== false
    && stopMatches(stop, wanted.destinationBranchId, wanted.destinationName)
  ));
  if (destinationOffset <= originOffset) return null;
  return {
    originStop: traversed[originOffset],
    destinationStop: traversed[destinationOffset],
  };
}

async function findReturnDepartures({ companyId, originName, destinationName, originBranchId = '', destinationBranchId = '' } = {}) {
  const tenantId = cleanText(companyId, 180);
  const wanted = {
    originName: cleanText(originName, 200),
    destinationName: cleanText(destinationName, 200),
    originBranchId: cleanText(originBranchId, 180),
    destinationBranchId: cleanText(destinationBranchId, 180),
  };
  if (!tenantId || (!wanted.originBranchId && !wanted.originName) || (!wanted.destinationBranchId && !wanted.destinationName)) return [];

  // Discover from live departures first. A route-only scan can miss a valid
  // return when a company owns many routes, a legacy route has no explicit
  // `active` status, or a schedule uses a subset of the route's stops.
  const departures = await repository.schedules.list({
    companyId: tenantId,
    status: { $in: ['published', 'boarding', 'delayed'] },
    // Return departures are independent services. Never compare their clock
    // time to the outbound departure/arrival; same-time future services remain
    // valid options when the operator has published them.
    departAt: { $gt: new Date() },
  }, { sort: { departAt: 1 }, limit: 1500 });
  if (!departures.length) return [];

  const routeIds = [...new Set(departures.map((row) => cleanText(row.routeId, 180)).filter(Boolean))];
  const routes = await repository.routes.list({
    companyId: tenantId,
    id: { $in: routeIds },
    status: { $ne: 'archived' },
  }, { limit: Math.max(200, routeIds.length + 20) });
  const routeById = new Map(routes.map((route) => [String(route.id || ''), route]));
  const usableRouteIds = [...routeById.keys()];
  if (!usableRouteIds.length) return [];

  const allStops = await repository.routeStops.list({
    companyId: tenantId,
    routeId: { $in: usableRouteIds },
    status: { $ne: 'archived' },
  }, { sort: { routeId: 1, stopOrder: 1 }, limit: 12000 });
  const stopsByRoute = new Map();
  for (const stop of allStops) {
    const key = String(stop.routeId || '');
    if (!stopsByRoute.has(key)) stopsByRoute.set(key, []);
    stopsByRoute.get(key).push(stop);
  }

  const results = [];
  for (const schedule of departures) {
    const route = routeById.get(String(schedule.routeId || ''));
    if (!route) continue;
    const stops = stopsByRoute.get(String(route.id || '')) || [];
    const journey = journeyForSchedule(schedule, route, stops, wanted);
    if (!journey) continue;
    results.push({
      id: schedule.id,
      listingId: schedule.listingId,
      companyId: schedule.companyId,
      routeId: schedule.routeId,
      vehicleId: schedule.vehicleId,
      vehicleClass: scheduleVehicleClass(schedule),
      originStopId: journey.originStop.id,
      destinationStopId: journey.destinationStop.id,
      originName: journey.originStop.name,
      destinationName: journey.destinationStop.name,
      departAt: schedule.departAt,
      arriveAt: schedule.arriveAt,
      departureLabel: `${new Date(schedule.departAt).toLocaleString('en-GB', { timeZone: schedule.routeSnapshot?.timezone || 'Africa/Kampala', dateStyle: 'medium', timeStyle: 'short' })} · ${schedule.vehicleName || 'Bus'}`,
      currency: schedule.currency,
      status: schedule.status,
    });
  }
  return results.sort((a, b) => new Date(a.departAt) - new Date(b.departAt)).slice(0, 120);
}

async function findReturnsForDeparture({ scheduleId, originStopId, destinationStopId } = {}) {
  const availability = await require('./busInventoryService').getAvailability({ scheduleId, originStopId, destinationStopId });
  const sourceSchedule = await repository.schedules.findOne({ id: cleanText(scheduleId, 180) });
  if (!sourceSchedule) return { outbound: availability.journey, departures: [] };
  const departures = await findReturnDepartures({
    companyId: sourceSchedule.companyId,
    originName: availability.journey.destinationName,
    destinationName: availability.journey.originName,
    originBranchId: availability.journey.destinationBranchId,
    destinationBranchId: availability.journey.originBranchId,
  });
  return { outbound: availability.journey, departures };
}

module.exports = {
  findReturnDepartures,
  findReturnsForDeparture,
  stopMatches,
  scheduleTravelBounds,
  journeyForSchedule,
  scheduleVehicleClass,
};

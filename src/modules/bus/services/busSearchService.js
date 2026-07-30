'use strict';

const repository = require('../repositories/busRepository');
const { cleanText, normalize } = require('../domain/busDomain');

function stopMatches(stop, wantedBranchId, wantedName) {
  const branchMatches = wantedBranchId
    && String(stop?.branchId || '') === wantedBranchId;
  const nameMatches = wantedName
    && normalize(stop?.name) === normalize(wantedName);
  // Older routes and manually-created stops may not carry a branchId even when
  // they refer to the same terminal. Branch identity is preferred, but the
  // canonical stop name remains a valid fallback for reverse-trip discovery.
  return Boolean(branchMatches || nameMatches);
}

async function findReturnDepartures({ companyId, originName, destinationName, originBranchId = '', destinationBranchId = '' } = {}) {
  const tenantId = cleanText(companyId, 180);
  const wantedOrigin = normalize(originName);
  const wantedDestination = normalize(destinationName);
  const wantedOriginBranch = cleanText(originBranchId, 180);
  const wantedDestinationBranch = cleanText(destinationBranchId, 180);
  if (!tenantId || (!wantedOriginBranch && !wantedOrigin) || (!wantedDestinationBranch && !wantedDestination)) return [];
  const routes = await repository.routes.list({ companyId: tenantId, status: 'active' }, { limit: 200 });
  if (!routes.length) return [];
  const routeIds = routes.map((route) => route.id).filter(Boolean);
  const allStops = await repository.routeStops.list({
    companyId: tenantId,
    routeId: { $in: routeIds },
    status: { $ne: 'archived' },
  }, { sort: { routeId: 1, stopOrder: 1 }, limit: 4000 });
  const stopsByRoute = new Map();
  for (const stop of allStops) {
    const key = String(stop.routeId || '');
    if (!stopsByRoute.has(key)) stopsByRoute.set(key, []);
    stopsByRoute.get(key).push(stop);
  }
  const matches = [];
  for (const route of routes) {
    const stops = stopsByRoute.get(String(route.id || '')) || [];
    const originIndex = stops.findIndex((stop) => stopMatches(stop, wantedOriginBranch, wantedOrigin));
    const destinationIndex = stops.findIndex((stop, index) => (
      index > originIndex
      && stopMatches(stop, wantedDestinationBranch, wantedDestination)
    ));
    if (originIndex < 0 || destinationIndex <= originIndex) continue;
    matches.push({ route, originStop: stops[originIndex], destinationStop: stops[destinationIndex] });
  }
  if (!matches.length) return [];
  const matchedRouteIds = matches.map((match) => match.route.id);
  const departures = await repository.schedules.list({
    companyId: tenantId,
    routeId: { $in: matchedRouteIds },
    status: { $in: ['published', 'boarding', 'delayed'] },
    // A reverse option is an independently scheduled journey. Do not compare
    // its clock time with the selected outbound journey; partners may publish
    // same-time or otherwise independently timed services.
    departAt: { $gt: new Date() },
  }, { sort: { departAt: 1 }, limit: 600 });
  const matchByRoute = new Map(matches.map((match) => [String(match.route.id || ''), match]));
  const results = [];
  for (const schedule of departures) {
    const match = matchByRoute.get(String(schedule.routeId || ''));
    if (!match) continue;
    results.push({
      id: schedule.id,
      listingId: schedule.listingId,
      companyId: schedule.companyId,
      routeId: schedule.routeId,
      vehicleId: schedule.vehicleId,
      originStopId: match.originStop.id,
      destinationStopId: match.destinationStop.id,
      originName: match.originStop.name,
      destinationName: match.destinationStop.name,
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
  const departures = await findReturnDepartures({
    companyId: (await repository.schedules.findOne({ id: scheduleId }))?.companyId,
    originName: availability.journey.destinationName,
    destinationName: availability.journey.originName,
    originBranchId: availability.journey.destinationBranchId,
    destinationBranchId: availability.journey.originBranchId,
  });
  return { outbound: availability.journey, departures };
}

module.exports = { findReturnDepartures, findReturnsForDeparture, stopMatches };

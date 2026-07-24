'use strict';

const repository = require('../repositories/busRepository');
const { cleanText, normalize } = require('../domain/busDomain');

async function findReturnDepartures({ companyId, originName, destinationName, afterDate } = {}) {
  const tenantId = cleanText(companyId, 180);
  const wantedOrigin = normalize(originName);
  const wantedDestination = normalize(destinationName);
  if (!tenantId || !wantedOrigin || !wantedDestination) return [];
  const routes = await repository.routes.list({ companyId: tenantId, status: 'active' }, { limit: 200 });
  const matches = [];
  for (const route of routes) {
    const stops = await repository.routeStops.list({ companyId: tenantId, routeId: route.id, status: { $ne: 'archived' } }, { sort: { stopOrder: 1 }, limit: 200 });
    const originIndex = stops.findIndex((stop) => normalize(stop.name) === wantedOrigin);
    const destinationIndex = stops.findIndex((stop, index) => index > originIndex && normalize(stop.name) === wantedDestination);
    if (originIndex < 0 || destinationIndex <= originIndex) continue;
    matches.push({ route, originStop: stops[originIndex], destinationStop: stops[destinationIndex] });
  }
  const threshold = new Date(afterDate || Date.now());
  const results = [];
  for (const match of matches) {
    const departures = await repository.schedules.list({
      companyId: tenantId,
      routeId: match.route.id,
      status: { $in: ['published', 'boarding', 'delayed'] },
      departAt: { $gt: threshold },
    }, { sort: { departAt: 1 }, limit: 60 });
    for (const schedule of departures) {
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
  }
  return results.sort((a, b) => new Date(a.departAt) - new Date(b.departAt)).slice(0, 120);
}

async function findReturnsForDeparture({ scheduleId, originStopId, destinationStopId } = {}) {
  const availability = await require('./busInventoryService').getAvailability({ scheduleId, originStopId, destinationStopId });
  const departures = await findReturnDepartures({
    companyId: (await repository.schedules.findOne({ id: scheduleId }))?.companyId,
    originName: availability.journey.destinationName,
    destinationName: availability.journey.originName,
    afterDate: availability.schedule.arriveAt || availability.schedule.departAt,
  });
  return { outbound: availability.journey, departures };
}

module.exports = { findReturnDepartures, findReturnsForDeparture };

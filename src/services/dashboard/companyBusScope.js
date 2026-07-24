'use strict';

function key(value) {
  return String(value == null ? '' : value).trim();
}

function rowId(row = {}) {
  return key(row?.id || row?._id);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueRows(rows = []) {
  const seen = new Set();
  return asArray(rows).filter((row) => {
    if (!row) return false;
    const id = rowId(row);
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

// Dashboard tenant scope is strict: every operational row must carry the owning companyId.
// Relationship fields narrow the result further; they never substitute for tenant ownership.
function buildCompanyBusScope(state = {}, companyId, companyListings = []) {
  const companyKey = key(companyId);
  const owned = (rows) => uniqueRows(rows).filter((row) => key(row.companyId) === companyKey);
  const listings = owned(companyListings);
  const listingIds = new Set(listings.map(rowId).filter(Boolean));

  const routes = owned(state.routes).filter((row) => listingIds.has(key(row.listingId)));
  const routeIds = new Set(routes.map(rowId).filter(Boolean));
  const vehicles = owned(state.vehicles).filter((row) => listingIds.has(key(row.listingId)));
  const vehicleIds = new Set(vehicles.map(rowId).filter(Boolean));
  const schedules = owned(state.schedules).filter((row) => listingIds.has(key(row.listingId))
    && routeIds.has(key(row.routeId)) && vehicleIds.has(key(row.vehicleId)));
  const scheduleIds = new Set(schedules.map(rowId).filter(Boolean));

  const seatMapVersions = owned(state.seatMapVersions).filter((row) => listingIds.has(key(row.listingId))
    && vehicleIds.has(key(row.vehicleId)));
  const seatMapVersionIds = new Set(seatMapVersions.map(rowId).filter(Boolean));
  const seatMapTemplates = owned(state.seatMapTemplates).filter((row) => listingIds.has(key(row.listingId))
    && vehicleIds.has(key(row.vehicleId)));

  const routeStops = owned(state.routeStops).filter((row) => routeIds.has(key(row.routeId)));
  const routeSegments = owned(state.routeSegments).filter((row) => routeIds.has(key(row.routeId)));
  const fareProducts = owned(state.fareProducts).filter((row) => listingIds.has(key(row.listingId))
    && routeIds.has(key(row.routeId)));
  const fareProductIds = new Set(fareProducts.map(rowId).filter(Boolean));
  const segmentFares = owned(state.busSegmentFares).filter((row) => fareProductIds.has(key(row.fareProductId))
    && routeIds.has(key(row.routeId)));
  const serviceAddons = owned(state.serviceAddons).filter((row) => listingIds.has(key(row.listingId)));
  const seats = owned(state.seats).filter((row) => scheduleIds.has(key(row.scheduleId))
    && (!row.seatMapVersionId || seatMapVersionIds.has(key(row.seatMapVersionId))));

  return {
    listings,
    listingIds,
    routes,
    routeIds,
    routeStops,
    routeSegments,
    vehicles,
    vehicleIds,
    schedules,
    scheduleIds,
    seatMapTemplates,
    seatMapVersions,
    fareProducts,
    segmentFares,
    serviceAddons,
    seats,
  };
}

module.exports = { buildCompanyBusScope, rowId, key };

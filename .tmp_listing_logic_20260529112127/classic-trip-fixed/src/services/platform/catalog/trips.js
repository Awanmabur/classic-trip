const mongoose = require("mongoose");
const { TripCatalog } = require("../../../models/platform");
const { getTenantConnection } = require("../../../core/tenancy/tenantConnectionManager");
const { getTenantModels } = require("../../../models/tenant");

const TYPE_ORDER = ["bus", "hotel", "flight", "train"];

const DEFAULT_IMAGES = {
  bus: "https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=1200&q=70",
  hotel: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=70",
  flight: "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1200&q=70",
  train: "https://images.unsplash.com/photo-1474487548417-781cb71495f3?auto=format&fit=crop&w=1200&q=70"
};

function titleForTrip(route = {}) {
  return route.title || `${route.from || route.city || "Classic"} -> ${route.to || route.city || "Trip"}`;
}

function imageForTrip(route = {}, vehicle = {}) {
  return (
    route.images?.[0]?.url ||
    vehicle.images?.[0]?.url ||
    DEFAULT_IMAGES[route.type] ||
    DEFAULT_IMAGES.bus
  );
}

function remainingSeats(trip = {}) {
  return Math.max(
    0,
    Number(trip.totalSeats || 0) - Number(trip.bookedSeats || 0) - Number(trip.heldSeats || 0)
  );
}

function toPublicCatalogTrip(doc) {
  return {
    _id: String(doc._id),
    tenantId: doc.tenantId ? String(doc.tenantId) : "",
    tenantSlug: doc.tenantSlug || "",
    type: doc.type || "bus",
    title: doc.title || "",
    description: doc.description || "",
    country: doc.country || "",
    city: doc.city || "",
    from: doc.from || "",
    to: doc.to || "",
    address: doc.address || "",
    partner: doc.partner || "Classic Trip Partner",
    departureAt: doc.departureAt,
    arriveAt: doc.arriveAt,
    basePrice: Number(doc.basePrice || 0),
    currency: doc.currency || "UGX",
    policy: doc.policy || "Instant confirmation",
    ratingAvg: Number(doc.ratingAvg || 0),
    ratingCount: Number(doc.ratingCount || 0),
    totalSeats: Number(doc.totalSeats || 0),
    bookedSeats: Number(doc.bookedSeats || 0),
    heldSeats: Number(doc.heldSeats || 0),
    remainingSeats: Number(doc.remainingSeats || 0),
    image: doc.image || DEFAULT_IMAGES[doc.type] || DEFAULT_IMAGES.bus,
    vehicle: {
      id: doc.vehicle?.id ? String(doc.vehicle.id) : "",
      name: doc.vehicle?.name || "",
      type: doc.vehicle?.type || doc.type || "bus",
      layoutName: doc.vehicle?.layoutName || "",
      rows: Number(doc.vehicle?.rows || 0),
      cols: Number(doc.vehicle?.cols || 0)
    }
  };
}

function buildCatalogPayload({ tenant, trip, route = {}, vehicle = {} }) {
  return {
    tenantId: tenant._id,
    tenantSlug: tenant.slug,
    ownerUserId: tenant.ownerUserId,
    sourceTripId: trip._id,
    sourceRouteId: route._id || null,
    sourceVehicleId: vehicle._id || null,
    status: trip.status || "scheduled",
    isActive: route.isActive !== false && trip.status === "scheduled",
    type: route.type || "bus",
    title: titleForTrip(route),
    description: route.description || "",
    country: route.country || "",
    city: route.city || "",
    from: route.from || route.city || "",
    to: route.to || route.city || "",
    address: route.address || "",
    partner: vehicle.name || tenant.name || "Classic Trip Partner",
    departureAt: trip.departureAt,
    arriveAt: trip.arriveAt || null,
    basePrice: Number(trip.basePrice || 0),
    currency: trip.currency || route.currency || tenant.currency || "UGX",
    policy: route.policy || "Instant confirmation",
    ratingAvg: Number(route.ratingAvg || 0),
    ratingCount: Number(route.ratingCount || 0),
    totalSeats: Number(trip.totalSeats || vehicle.totalSeats || 0),
    bookedSeats: Number(trip.bookedSeats || 0),
    heldSeats: Number(trip.heldSeats || 0),
    remainingSeats: remainingSeats(trip),
    image: imageForTrip(route, vehicle),
    vehicle: {
      id: vehicle._id || null,
      name: vehicle.name || "",
      type: vehicle.type || route.type || "bus",
      layoutName: vehicle.layoutName || "",
      rows: Number(vehicle.rows || 0),
      cols: Number(vehicle.cols || 0)
    }
  };
}

async function upsertTripCatalog({ tenant, trip, route, vehicle }) {
  const payload = buildCatalogPayload({ tenant, trip, route, vehicle });
  return TripCatalog.findOneAndUpdate(
    { tenantId: tenant._id, sourceTripId: trip._id },
    { $set: payload },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );
}

async function removeTripCatalogBySourceTrip(tenantId, sourceTripId) {
  return TripCatalog.findOneAndDelete({ tenantId, sourceTripId });
}

async function syncTripCatalogByTrip({ tenant, models, tripId }) {
  const { Trip, Route, Vehicle } = models || {};
  if (!tenant || !Trip || !Route || !Vehicle || !tripId) return null;

  const trip = await Trip.findById(tripId).lean();
  if (!trip) {
    return removeTripCatalogBySourceTrip(tenant._id, tripId);
  }

  const [route, vehicle] = await Promise.all([
    trip.routeId ? Route.findById(trip.routeId).lean() : Promise.resolve(null),
    trip.vehicleId ? Vehicle.findById(trip.vehicleId).lean() : Promise.resolve(null)
  ]);

  return upsertTripCatalog({
    tenant,
    trip,
    route: route || {},
    vehicle: vehicle || {}
  });
}

async function syncTripCatalogsByRoute({ tenant, models, routeId }) {
  const { Trip } = models || {};
  if (!tenant || !Trip || !routeId) return [];

  const trips = await Trip.find({ routeId }).select("_id").lean();
  return Promise.all(
    trips.map((trip) =>
      syncTripCatalogByTrip({
        tenant,
        models,
        tripId: trip._id
      })
    )
  );
}

async function syncTripCatalogsByVehicle({ tenant, models, vehicleId }) {
  const { Trip } = models || {};
  if (!tenant || !Trip || !vehicleId) return [];

  const trips = await Trip.find({ vehicleId }).select("_id").lean();
  return Promise.all(
    trips.map((trip) =>
      syncTripCatalogByTrip({
        tenant,
        models,
        tripId: trip._id
      })
    )
  );
}

async function syncTenantCatalogByOwner({ tenant, ownerUserId = "" }) {
  if (!tenant) return { synced: 0 };

  const connection = await getTenantConnection(tenant);
  const models = getTenantModels(connection);
  const { Trip, Route, Vehicle } = models;
  const ownerFilter = String(ownerUserId || tenant.ownerUserId || "").trim();
  const tripFilter = ownerFilter ? { ownerId: ownerFilter } : {};

  const trips = await Trip.find(tripFilter).lean();
  const routeIds = [...new Set(trips.map((trip) => String(trip.routeId || "")).filter(Boolean))];
  const vehicleIds = [...new Set(trips.map((trip) => String(trip.vehicleId || "")).filter(Boolean))];

  const [routes, vehicles] = await Promise.all([
    routeIds.length ? Route.find({ _id: { $in: routeIds } }).lean() : Promise.resolve([]),
    vehicleIds.length ? Vehicle.find({ _id: { $in: vehicleIds } }).lean() : Promise.resolve([])
  ]);

  const routesById = new Map(routes.map((route) => [String(route._id), route]));
  const vehiclesById = new Map(vehicles.map((vehicle) => [String(vehicle._id), vehicle]));

  for (const trip of trips) {
    await upsertTripCatalog({
      tenant,
      trip,
      route: routesById.get(String(trip.routeId)) || {},
      vehicle: vehiclesById.get(String(trip.vehicleId)) || {}
    });
  }

  const sourceTripIds = trips.map((trip) => trip._id);
  await TripCatalog.deleteMany({
    tenantId: tenant._id,
    ...(sourceTripIds.length ? { sourceTripId: { $nin: sourceTripIds } } : {})
  });

  return { synced: trips.length };
}

async function findTripCatalogByPublicId(publicTripId) {
  if (!mongoose.Types.ObjectId.isValid(publicTripId)) return null;
  return TripCatalog.findById(publicTripId).lean();
}

async function findTripCatalogBySourceTripId(sourceTripId) {
  if (!mongoose.Types.ObjectId.isValid(sourceTripId)) return null;
  return TripCatalog.findOne({ sourceTripId }).lean();
}

async function fetchMarketplaceTrips(limit = 80, options = {}) {
  const filter = {
    isActive: true,
    status: "scheduled",
    departureAt: { $gte: new Date(Date.now() - 6 * 60 * 60 * 1000) }
  };

  if (options.tenantId) {
    filter.tenantId = options.tenantId;
  } else if (options.tenantSlug) {
    filter.tenantSlug = String(options.tenantSlug || "").trim().toLowerCase();
  }

  const docs = await TripCatalog.find(filter)
    .sort({ departureAt: 1 })
    .limit(limit)
    .lean();

  return docs.map(toPublicCatalogTrip);
}

module.exports = {
  DEFAULT_IMAGES,
  TYPE_ORDER,
  buildCatalogPayload,
  fetchMarketplaceTrips,
  findTripCatalogByPublicId,
  findTripCatalogBySourceTripId,
  removeTripCatalogBySourceTrip,
  syncTripCatalogByTrip,
  syncTenantCatalogByOwner,
  syncTripCatalogsByRoute,
  syncTripCatalogsByVehicle,
  toPublicCatalogTrip,
  upsertTripCatalog
};

const { asyncHandler } = require("../../middleware/http");
const { TripCatalog } = require("../../models/platform");
const { getTenantAccessForRequest } = require("../../services/tenant/runtime");
const { toPublicCatalogTrip, upsertTripCatalog } = require("../../services/platform/catalog");

exports.create = asyncHandler(async (req, res) => {
  const { routeId, vehicleId, departureAt, arriveAt, basePrice, currency = "UGX" } = req.body;
  const { tenant, models, ownerUserId } = await getTenantAccessForRequest(req);
  const { Trip, Vehicle, Route } = models;

  const route = await Route.findById(routeId);
  if (!route) return res.status(404).json({ ok: false, message: "Route not found" });

  const vehicle = await Vehicle.findById(vehicleId);
  if (!vehicle) return res.status(404).json({ ok: false, message: "Vehicle not found" });

  // owner check
  if (!["admin", "super_admin"].includes(req.user.role)) {
    if (String(route.ownerId) !== String(ownerUserId) || String(vehicle.ownerId) !== String(ownerUserId)) {
      return res.status(403).json({ ok: false, message: "Route/Vehicle must belong to you" });
    }
  }

  const trip = await Trip.create({
    ownerId: route.ownerId || ownerUserId,
    routeId,
    vehicleId,
    departureAt: new Date(departureAt),
    arriveAt: arriveAt ? new Date(arriveAt) : undefined,
    basePrice: Number(basePrice),
    currency,
    totalSeats: vehicle.totalSeats,
    bookedSeats: 0,
    heldSeats: 0,
    status: "scheduled"
  });

  if (tenant) {
    await upsertTripCatalog({ tenant, trip, route, vehicle });
  }

  res.status(201).json({ ok: true, trip });
});

exports.searchPublic = asyncHandler(async (req, res) => {
  const { type, from, to, date, country, city, page = 1, limit = 12 } = req.query;
  const filter = { isActive: true, status: "scheduled" };
  if (req.tenant?._id) filter.tenantId = req.tenant._id;
  if (type) filter.type = type;
  if (from) filter.from = from;
  if (to) filter.to = to;
  if (country) filter.country = country;
  if (city) filter.city = city;
  if (date) {
    const d = new Date(date);
    const start = new Date(d);
    start.setHours(0, 0, 0, 0);
    const end = new Date(d);
    end.setHours(23, 59, 59, 999);
    filter.departureAt = { $gte: start, $lte: end };
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    TripCatalog.find(filter).sort("departureAt").skip(skip).limit(Number(limit)).lean(),
    TripCatalog.countDocuments(filter)
  ]);

  res.json({
    ok: true,
    page: Number(page),
    limit: Number(limit),
    total,
    pages: Math.ceil(total / Number(limit)),
    items: items.map(toPublicCatalogTrip)
  });
});

exports.getOne = asyncHandler(async (req, res) => {
  const trip = await TripCatalog.findOne({
    _id: req.params.id,
    ...(req.tenant?._id ? { tenantId: req.tenant._id } : {})
  }).lean();
  if (!trip) return res.status(404).json({ ok: false, message: "Trip not found" });

  res.json({ ok: true, trip: toPublicCatalogTrip(trip) });
});

exports.update = asyncHandler(async (req, res) => {
  const { departureAt, arriveAt, basePrice, currency, status } = req.validated?.body || req.body;
  const { tenant, models, ownerUserId } = await getTenantAccessForRequest(req);
  const { Trip } = models;

  const trip = await Trip.findById(req.params.id);
  if (!trip) return res.status(404).json({ ok: false, message: "Trip not found" });

  const isAdmin = ["admin", "super_admin"].includes(req.user.role);
  if (!isAdmin && String(trip.ownerId) !== String(ownerUserId)) {
    return res.status(403).json({ ok: false, message: "Forbidden" });
  }

  if (departureAt) trip.departureAt = new Date(departureAt);
  if (arriveAt) trip.arriveAt = new Date(arriveAt);
  if (basePrice != null) trip.basePrice = Number(basePrice);
  if (currency) trip.currency = currency;
  if (status) trip.status = status;
  await trip.save();

  if (tenant) {
    const { Route, Vehicle } = models;
    const [route, vehicle] = await Promise.all([
      trip.routeId ? Route.findById(trip.routeId).lean() : Promise.resolve({}),
      trip.vehicleId ? Vehicle.findById(trip.vehicleId).lean() : Promise.resolve({})
    ]);
    await upsertTripCatalog({ tenant, trip, route: route || {}, vehicle: vehicle || {} });
  }

  res.json({ ok: true, trip });
});

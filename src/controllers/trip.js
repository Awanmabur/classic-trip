const asyncHandler = require("../middleware/asyncHandler");
const Trip = require("../models/trip");
const Vehicle = require("../models/vehicle");
const Route = require("../models/route");

exports.create = asyncHandler(async (req, res) => {
  const { routeId, vehicleId, departureAt, arriveAt, basePrice, currency = "UGX" } = req.body;

  const route = await Route.findById(routeId);
  if (!route) return res.status(404).json({ ok: false, message: "Route not found" });

  const vehicle = await Vehicle.findById(vehicleId);
  if (!vehicle) return res.status(404).json({ ok: false, message: "Vehicle not found" });

  // owner check
  if (req.user.role !== "admin") {
    if (String(route.ownerId) !== String(req.user.userId) || String(vehicle.ownerId) !== String(req.user.userId)) {
      return res.status(403).json({ ok: false, message: "Route/Vehicle must belong to you" });
    }
  }

  const trip = await Trip.create({
    ownerId: route.ownerId,
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

  res.status(201).json({ ok: true, trip });
});

exports.searchPublic = asyncHandler(async (req, res) => {
  const { type, from, to, date, country, city, page = 1, limit = 12 } = req.query;

  const filter = { status: "scheduled" };
  if (date) {
    const d = new Date(date);
    const start = new Date(d);
    start.setHours(0,0,0,0);
    const end = new Date(d);
    end.setHours(23,59,59,999);
    filter.departureAt = { $gte: start, $lte: end };
  }

  // join route filter by querying routes first if needed
  let routeIds = null;
  if (type || from || to || country || city) {
    const rf = { isActive: true };
    if (type) rf.type = type;
    if (from) rf.from = from;
    if (to) rf.to = to;
    if (country) rf.country = country;
    if (city) rf.city = city;
    const routes = await Route.find(rf).select("_id").lean();
    routeIds = routes.map(r => r._id);
    filter.routeId = { $in: routeIds.length ? routeIds : [null] };
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    Trip.find(filter)
      .populate("routeId")
      .populate("vehicleId", "name type layoutName rows cols totalSeats")
      .sort("departureAt")
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Trip.countDocuments(filter)
  ]);

  res.json({
    ok: true,
    page: Number(page),
    limit: Number(limit),
    total,
    pages: Math.ceil(total / Number(limit)),
    items
  });
});

exports.getOne = asyncHandler(async (req, res) => {
  const trip = await Trip.findById(req.params.id)
    .populate("routeId")
    .populate("vehicleId", "name type layoutName rows cols totalSeats")
    .lean();
  if (!trip) return res.status(404).json({ ok: false, message: "Trip not found" });

  res.json({ ok: true, trip });
});

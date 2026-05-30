const { asyncHandler } = require("../../middleware/http");
const { TripCatalog } = require("../../models/platform");
const { Booking } = require("../../models/shared");
const { getTenantAccessByTenantId, getTenantAccessForRequest } = require("../../services/tenant/runtime");

function scopedOwnerId(user, ownerIdOverride = "") {
  if (["admin", "super_admin"].includes(user.role)) {
    return ownerIdOverride || null;
  }
  return user.companyId || user.userId;
}

function manifestBookingFilter(trip, tenant, ownerUserId) {
  const filter = {
    tripId: trip._id,
    status: { $in: ["confirmed", "pending_payment"] }
  };

  if (tenant?._id && ownerUserId) {
    filter.$or = [
      { tenantId: tenant._id },
      { ownerId: ownerUserId }
    ];
  } else if (tenant?._id) {
    filter.tenantId = tenant._id;
  } else if (ownerUserId) {
    filter.ownerId = ownerUserId;
  }

  return filter;
}

function catalogTripCard(catalog) {
  return {
    _id: catalog.sourceTripId,
    ownerId: catalog.ownerUserId,
    departureAt: catalog.departureAt,
    arriveAt: catalog.arriveAt || null,
    totalSeats: Number(catalog.totalSeats || 0),
    bookedSeats: Number(catalog.bookedSeats || 0),
    heldSeats: Number(catalog.heldSeats || 0),
    status: catalog.status || "scheduled",
    title: catalog.title || "",
    type: catalog.type || "bus",
    tenantId: catalog.tenantId,
    tenantSlug: catalog.tenantSlug || ""
  };
}

async function resolveTripAccess(req, tripId) {
  const ownerId = String(req.query.ownerId || "").trim();
  const access = await getTenantAccessForRequest(req, { ownerIdOverride: ownerId });
  const tripObjectId = tripId || "";

  if (access.models?.Trip) {
    const trip = await access.models.Trip.findById(tripObjectId).lean();
    if (trip) {
      return {
        ...access,
        trip,
        ownerUserId: String(trip.ownerId || access.ownerUserId || "")
      };
    }
  }

  const catalog = await TripCatalog.findOne({ sourceTripId: tripObjectId })
    .select("tenantId ownerUserId sourceTripId")
    .lean();
  if (!catalog?.tenantId) {
    return { ...access, trip: null };
  }

  const tenantAccess = await getTenantAccessByTenantId(catalog.tenantId);
  if (!tenantAccess.models?.Trip) {
    return { ...tenantAccess, trip: null, ownerUserId: String(catalog.ownerUserId || "") };
  }

  const trip = await tenantAccess.models.Trip.findById(tripObjectId).lean();
  return {
    ...tenantAccess,
    trip,
    ownerUserId: String(catalog.ownerUserId || "")
  };
}

exports.dashboard = asyncHandler(async (req, res) => {
  const ownerId = scopedOwnerId(req.user, req.query.ownerId || "");
  if (!ownerId && ["admin", "super_admin"].includes(req.user.role)) {
    const [tripCount, trips, totalBookings, confirmedBookings] = await Promise.all([
      TripCatalog.countDocuments({}),
      TripCatalog.find({})
        .sort("-departureAt")
        .limit(20)
        .lean(),
      Booking.countDocuments({}),
      Booking.countDocuments({ status: "confirmed" })
    ]);

    return res.json({
      ok: true,
      stats: {
        trips: tripCount,
        totalBookings,
        confirmedBookings
      },
      recentTrips: trips.map(catalogTripCard)
    });
  }

  const { models, ownerUserId } = await getTenantAccessForRequest(req, { ownerIdOverride: ownerId || "" });
  const { Trip } = models;
  const filter = ownerId || ownerUserId ? { ownerId: ownerId || ownerUserId } : {};

  const [trips, tripCount, totalBookings, confirmedBookings] = await Promise.all([
    Trip.find(filter).sort("-departureAt").limit(20).lean(),
    Trip.countDocuments(filter),
    Booking.countDocuments(ownerId || ownerUserId ? { ownerId: ownerId || ownerUserId } : {}),
    Booking.countDocuments(ownerId || ownerUserId ? { ownerId: ownerId || ownerUserId, status: "confirmed" } : { status: "confirmed" })
  ]);

  res.json({
    ok: true,
    stats: {
      trips: tripCount,
      totalBookings,
      confirmedBookings
    },
    recentTrips: trips
  });
});

exports.tripOccupancy = asyncHandler(async (req, res) => {
  const { trip, models, ownerUserId } = await resolveTripAccess(req, req.params.tripId);
  if (!trip) return res.status(404).json({ ok: false, message: "Trip not found" });

  const ownerId = scopedOwnerId(req.user, req.query.ownerId || "");
  if (!["admin", "super_admin"].includes(req.user.role) && String(trip.ownerId) !== String(ownerId)) {
    return res.status(403).json({ ok: false, message: "Forbidden" });
  }
  if (!models?.SeatBooking || !models?.SeatHold) {
    return res.status(500).json({ ok: false, message: "Tenant inventory is unavailable" });
  }

  const { SeatBooking, SeatHold } = models;

  const [booked, holdCount] = await Promise.all([
    SeatBooking.find({ tripId: trip._id }).select("seatId bookingId").lean(),
    SeatHold.countDocuments({ tripId: trip._id })
  ]);

  res.json({
    ok: true,
    trip: {
      id: trip._id,
      departureAt: trip.departureAt,
      totalSeats: trip.totalSeats,
      bookedSeats: booked.length,
      heldSeats: holdCount,
      remainingSeats: Math.max(0, trip.totalSeats - booked.length - holdCount)
    },
    seatsTaken: booked.map(x => x.seatId)
  });
});

exports.tripManifest = asyncHandler(async (req, res) => {
  const { trip, tenant, ownerUserId } = await resolveTripAccess(req, req.params.tripId);
  if (!trip) return res.status(404).json({ ok: false, message: "Trip not found" });

  const ownerId = scopedOwnerId(req.user, req.query.ownerId || "");
  if (!["admin", "super_admin"].includes(req.user.role) && String(trip.ownerId) !== String(ownerId)) {
    return res.status(403).json({ ok: false, message: "Forbidden" });
  }

  const bookings = await Booking.find(manifestBookingFilter(trip, tenant, ownerUserId))
    .populate("userId", "name email phone")
    .select("status userId guest guestLookupCode seats amount currency createdAt")
    .sort("createdAt")
    .lean();

  res.json({ ok: true, trip, bookings });
});

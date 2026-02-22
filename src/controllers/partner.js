const asyncHandler = require("../middleware/asyncHandler");
const Trip = require("../models/trip");
const Booking = require("../models/booking");
const SeatBooking = require("../models/seatBooking");
const SeatHold = require("../models/seatHold");

exports.dashboard = asyncHandler(async (req, res) => {
  const ownerId = req.user.role === "admin" ? (req.query.ownerId || null) : req.user.userId;
  const filter = ownerId ? { ownerId } : {};

  const [trips, totalBookings, confirmedBookings] = await Promise.all([
    Trip.find(filter).sort("-departureAt").limit(20).lean(),
    Booking.countDocuments(ownerId ? { ownerId } : {}),
    Booking.countDocuments(ownerId ? { ownerId, status: "confirmed" } : { status: "confirmed" })
  ]);

  res.json({
    ok: true,
    stats: {
      trips: trips.length,
      totalBookings,
      confirmedBookings
    },
    recentTrips: trips
  });
});

exports.tripOccupancy = asyncHandler(async (req, res) => {
  const trip = await Trip.findById(req.params.tripId).lean();
  if (!trip) return res.status(404).json({ ok: false, message: "Trip not found" });

  if (req.user.role !== "admin" && String(trip.ownerId) !== String(req.user.userId)) {
    return res.status(403).json({ ok: false, message: "Forbidden" });
  }

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
  const trip = await Trip.findById(req.params.tripId).lean();
  if (!trip) return res.status(404).json({ ok: false, message: "Trip not found" });

  if (req.user.role !== "admin" && String(trip.ownerId) !== String(req.user.userId)) {
    return res.status(403).json({ ok: false, message: "Forbidden" });
  }

  const bookings = await Booking.find({ tripId: trip._id, status: { $in: ["confirmed", "pending_payment"] } })
    .populate("userId", "name email phone")
    .select("status userId guest guestLookupCode seats amount currency createdAt")
    .sort("createdAt")
    .lean();

  res.json({ ok: true, trip, bookings });
});

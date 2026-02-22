const asyncHandler = require("../middleware/asyncHandler");
const Trip = require("../models/trip");
const Vehicle = require("../models/vehicle");
const SeatHold = require("../models/seatHold");
const SeatBooking = require("../models/seatBooking");
const { SEAT_HOLD_MINUTES } = require("../config/env");

// public seat map
exports.getSeatMap = asyncHandler(async (req, res) => {
  const trip = await Trip.findById(req.params.tripId).lean();
  if (!trip) return res.status(404).json({ ok: false, message: "Trip not found" });

  const vehicle = await Vehicle.findById(trip.vehicleId).lean();
  if (!vehicle) return res.status(404).json({ ok: false, message: "Vehicle not found" });

  const [booked, holds] = await Promise.all([
    SeatBooking.find({ tripId: trip._id }).select("seatId -_id").lean(),
    SeatHold.find({ tripId: trip._id }).select("seatId expiresAt -_id").lean()
  ]);

  const bookedSeats = booked.map(b => b.seatId);
  const heldSeats = holds.map(h => h.seatId);

  res.json({
    ok: true,
    trip: {
      id: trip._id,
      departureAt: trip.departureAt,
      totalSeats: trip.totalSeats,
      bookedSeats: trip.bookedSeats,
      heldSeats: trip.heldSeats,
      remainingSeats: Math.max(0, trip.totalSeats - trip.bookedSeats - trip.heldSeats)
    },
    vehicle: {
      id: vehicle._id,
      name: vehicle.name,
      type: vehicle.type,
      layoutName: vehicle.layoutName,
      rows: vehicle.rows,
      cols: vehicle.cols,
      totalSeats: vehicle.totalSeats,
      seats: vehicle.seats
    },
    availability: {
      bookedSeats,
      heldSeats
    }
  });
});

// customer hold seats
exports.holdSeats = asyncHandler(async (req, res) => {
  const seatIds = Array.isArray(req.body.seats) ? req.body.seats.map(s => String(s).trim()).filter(Boolean) : [];
  if (!seatIds.length) return res.status(400).json({ ok: false, message: "seats[] required" });

  const trip = await Trip.findById(req.params.tripId);
  if (!trip || trip.status !== "scheduled") return res.status(404).json({ ok: false, message: "Trip not available" });

  // seats already booked?
  const booked = await SeatBooking.find({ tripId: trip._id, seatId: { $in: seatIds } }).select("seatId").lean();
  if (booked.length) {
    return res.status(409).json({ ok: false, message: "Some seats already booked", seats: booked.map(x => x.seatId) });
  }

  const expiresAt = new Date(Date.now() + SEAT_HOLD_MINUTES * 60 * 1000);

  // insert holds (unique index stops conflicts)
  const docs = seatIds.map(seatId => ({ tripId: trip._id, seatId, userId: req.user.userId, expiresAt }));

  try {
    await SeatHold.insertMany(docs, { ordered: false });
  } catch (e) {
    // ignore dup key errors, we'll return what you got
  }

  const mine = await SeatHold.find({
    tripId: trip._id,
    userId: req.user.userId,
    seatId: { $in: seatIds }
  }).select("seatId expiresAt -_id").lean();

  // refresh counters
  const holdCount = await SeatHold.countDocuments({ tripId: trip._id });
  trip.heldSeats = holdCount;
  await trip.save();

  res.json({
    ok: true,
    heldByYou: mine.map(x => x.seatId),
    expiresAt,
    holdMinutes: SEAT_HOLD_MINUTES
  });
});

// customer release holds (selected seats or all)
exports.releaseHolds = asyncHandler(async (req, res) => {
  const seatIds = Array.isArray(req.body.seats) ? req.body.seats.map(s => String(s).trim()).filter(Boolean) : null;

  const q = { tripId: req.params.tripId, userId: req.user.userId };
  if (seatIds && seatIds.length) q.seatId = { $in: seatIds };

  await SeatHold.deleteMany(q);

  const trip = await Trip.findById(req.params.tripId);
  if (trip) {
    const holdCount = await SeatHold.countDocuments({ tripId: trip._id });
    trip.heldSeats = holdCount;
    await trip.save();
  }

  res.json({ ok: true, message: "Released" });
});

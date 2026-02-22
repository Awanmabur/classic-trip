const asyncHandler = require("../middleware/asyncHandler");
const User = require("../models/user");
const Booking = require("../models/booking");
const Trip = require("../models/trip");
const SeatBooking = require("../models/seatBooking");

exports.stats = asyncHandler(async (_req, res) => {
  const [users, partners, trips, bookings, confirmed] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ role: "partner" }),
    Trip.countDocuments(),
    Booking.countDocuments(),
    Booking.countDocuments({ status: "confirmed" })
  ]);

  const revenueAgg = await Booking.aggregate([
    { $match: { status: "confirmed" } },
    { $group: { _id: "$currency", total: { $sum: "$amount" } } }
  ]);

  res.json({ ok: true, stats: { users, partners, trips, bookings, confirmed, revenue: revenueAgg } });
});

exports.users = asyncHandler(async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  const q = String(req.query.q || "").trim();
  const filter = q
    ? { $or: [{ email: new RegExp(q, "i") }, { name: new RegExp(q, "i") }, { referralCode: new RegExp(q, "i") }] }
    : {};
  const items = await User.find(filter).select("name email phone role status referralCode createdAt").sort("-createdAt").limit(limit).lean();
  res.json({ ok: true, items });
});

exports.bookings = asyncHandler(async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  const items = await Booking.find()
    .populate({ path: "tripId", populate: [{ path: "routeId" }, { path: "vehicleId", select: "name" }] })
    .sort("-createdAt")
    .limit(limit)
    .lean();
  res.json({ ok: true, items });
});

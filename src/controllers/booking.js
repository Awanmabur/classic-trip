const asyncHandler = require("../middleware/asyncHandler");
const mongoose = require("mongoose");
const crypto = require("crypto");

const Trip = require("../models/trip");
const SeatHold = require("../models/seatHold");
const SeatBooking = require("../models/seatBooking");
const Booking = require("../models/booking");
const User = require("../models/user");
const { credit, redeem } = require("../services/wallet");

function cleanSeats(seats) {
  return Array.isArray(seats) ? seats.map(s => String(s).trim()).filter(Boolean) : [];
}
function makeLookupCode() {
  return "GT-" + crypto.randomBytes(6).toString("hex").toUpperCase();
}
async function resolveReferral(referralCode) {
  const code = String(referralCode || "").trim();
  if (!code) return { code: "", user: null, percent: 0 };
  const user = await User.findOne({ referralCode: code }).select("_id referralCode").lean();
  if (!user) return { code, user: null, percent: 0 };
  return { code: user.referralCode, user, percent: 5 };
}

// Logged-in confirm: must hold seats owned by user. Supports wallet redemption + referral credit.
exports.confirm = asyncHandler(async (req, res) => {
  const {
    tripId,
    seats,
    paymentProvider = "none",
    paymentRef = "",
    referralCode = "",
    useWallet = false
  } = req.body;

  const seatIds = cleanSeats(seats);
  if (!tripId || !seatIds.length) return res.status(400).json({ ok: false, message: "tripId and seats[] required" });

  const session = await mongoose.startSession();
  try {
    let created;

    await session.withTransaction(async () => {
      const trip = await Trip.findById(tripId).session(session);
      if (!trip || trip.status !== "scheduled") throw Object.assign(new Error("Trip not available"), { statusCode: 404 });

      // must hold seats (not expired due to TTL) and owned by user
      const holds = await SeatHold.find({
        tripId: trip._id,
        userId: req.user.userId,
        seatId: { $in: seatIds }
      }).session(session);

      if (holds.length !== seatIds.length) {
        throw Object.assign(new Error("Some seats are not held by you (or expired). Please reselect."), { statusCode: 409 });
      }

      // hard book seats (unique index prevents double booking)
      const bookingId = new mongoose.Types.ObjectId();

      await SeatBooking.insertMany(
        seatIds.map(seatId => ({ tripId: trip._id, seatId, bookingId })),
        { session }
      );

      const baseAmount = trip.basePrice * seatIds.length;

      // wallet redemption (discount)
      let walletUsed = 0;
      if (useWallet) {
        const r = await redeem(req.user.userId, baseAmount, trip.currency, { bookingId, note: "Redeemed on booking" });
        walletUsed = r.used || 0;
      }
      const amount = Math.max(0, baseAmount - walletUsed);

      // referral tracking
      const ref = await resolveReferral(referralCode);
      created = await Booking.create(
        [{
          _id: bookingId,
          userId: req.user.userId,
          ownerId: trip.ownerId,
          tripId: trip._id,
          travelDate: trip.departureAt,
          seats: seatIds.map(seatId => ({ seatId, price: trip.basePrice })),
          quantity: seatIds.length,
          amount,
          currency: trip.currency,
          walletUsed,
          referralCode: ref.code || "",
          referralUserId: ref.user?._id,
          referralPercent: ref.percent || 0,
          status: paymentProvider === "none" ? "confirmed" : "pending_payment",
          paymentProvider,
          paymentRef
        }],
        { session }
      );

      // remove holds
      await SeatHold.deleteMany({ tripId: trip._id, seatId: { $in: seatIds } }).session(session);

      // update counters
      trip.bookedSeats += seatIds.length;
      trip.heldSeats = await SeatHold.countDocuments({ tripId: trip._id }).session(session);
      await trip.save({ session });

      // referral credit (after booking confirmed for demo)
      if (created[0].status === "confirmed" && ref.user?._id) {
        const commission = Math.round((amount * (ref.percent || 0)) / 100);
        await credit(ref.user._id, commission, trip.currency, {
          sourceBookingId: bookingId,
          bookingId: bookingId,
          note: `Referral ${ref.percent}% on booking ${bookingId.toString()}`
        });
      }
    });

    res.status(201).json({ ok: true, booking: created[0] });
  } finally {
    await session.endSession();
  }
});

// Guest booking (no login): books seats directly if not booked and not held by someone else.
// Supports referral credit to promoter, and returns a lookupCode the guest can use to view the booking.
exports.guestConfirm = asyncHandler(async (req, res) => {
  const { tripId, seats, guest = {}, referralCode = "" } = req.body;
  const seatIds = cleanSeats(seats);
  if (!tripId || !seatIds.length) return res.status(400).json({ ok: false, message: "tripId and seats[] required" });

  const guestName = String(guest.name || "").trim();
  const guestEmail = String(guest.email || "").trim().toLowerCase();
  const guestPhone = String(guest.phone || "").trim();

  if (!guestName && !guestEmail && !guestPhone) {
    return res.status(400).json({ ok: false, message: "guest info required (name/email/phone)" });
  }

  const session = await mongoose.startSession();
  try {
    let created;
    await session.withTransaction(async () => {
      const trip = await Trip.findById(tripId).session(session);
      if (!trip || trip.status !== "scheduled") throw Object.assign(new Error("Trip not available"), { statusCode: 404 });

      // Reject seats that are currently held by someone else (TTL will auto-clean expired holds)
      const heldCount = await SeatHold.countDocuments({ tripId: trip._id, seatId: { $in: seatIds } }).session(session);
      if (heldCount) throw Object.assign(new Error("Some seats are temporarily held. Please choose different seats."), { statusCode: 409 });

      const bookingId = new mongoose.Types.ObjectId();

      await SeatBooking.insertMany(
        seatIds.map(seatId => ({ tripId: trip._id, seatId, bookingId })),
        { session }
      );

      const amount = trip.basePrice * seatIds.length;

      const ref = await resolveReferral(referralCode);
      const lookupCode = makeLookupCode();

      created = await Booking.create(
        [{
          _id: bookingId,
          userId: null,
          guest: { name: guestName, email: guestEmail, phone: guestPhone },
          guestLookupCode: lookupCode,
          ownerId: trip.ownerId,
          tripId: trip._id,
          travelDate: trip.departureAt,
          seats: seatIds.map(seatId => ({ seatId, price: trip.basePrice })),
          quantity: seatIds.length,
          amount,
          currency: trip.currency,
          referralCode: ref.code || "",
          referralUserId: ref.user?._id,
          referralPercent: ref.percent || 0,
          status: "confirmed",
          paymentProvider: "none",
          paymentRef: ""
        }],
        { session }
      );

      trip.bookedSeats += seatIds.length;
      trip.heldSeats = await SeatHold.countDocuments({ tripId: trip._id }).session(session);
      await trip.save({ session });

      if (ref.user?._id) {
        const commission = Math.round((amount * (ref.percent || 0)) / 100);
        await credit(ref.user._id, commission, trip.currency, {
          sourceBookingId: bookingId,
          bookingId: bookingId,
          note: `Referral ${ref.percent}% on guest booking ${bookingId.toString()}`
        });
      }
    });

    res.status(201).json({ ok: true, booking: created[0] });
  } finally {
    await session.endSession();
  }
});

exports.myBookings = asyncHandler(async (req, res) => {
  const items = await Booking.find({ userId: req.user.userId })
    .populate({ path: "tripId", populate: [{ path: "routeId" }, { path: "vehicleId", select: "name layoutName rows cols" }] })
    .sort("-createdAt")
    .lean();
  res.json({ ok: true, items });
});

exports.guestLookup = asyncHandler(async (req, res) => {
  const code = String(req.params.lookupCode || "").trim();
  if (!code) return res.status(400).json({ ok: false, message: "lookupCode required" });
  const booking = await Booking.findOne({ guestLookupCode: code })
    .populate({ path: "tripId", populate: [{ path: "routeId" }, { path: "vehicleId", select: "name layoutName rows cols" }] })
    .lean();
  if (!booking) return res.status(404).json({ ok: false, message: "Booking not found" });
  res.json({ ok: true, booking });
});

exports.cancel = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) return res.status(404).json({ ok: false, message: "Booking not found" });

  if (req.user.role !== "admin" && String(booking.userId) !== String(req.user.userId)) {
    return res.status(403).json({ ok: false, message: "Forbidden" });
  }

  if (booking.status === "cancelled") return res.json({ ok: true, booking });

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      booking.status = "cancelled";
      await booking.save({ session });

      // free seats
      await SeatBooking.deleteMany({ bookingId: booking._id }).session(session);

      // update trip counters
      const trip = await Trip.findById(booking.tripId).session(session);
      if (trip) {
        trip.bookedSeats = await SeatBooking.countDocuments({ tripId: trip._id }).session(session);
        trip.heldSeats = await SeatHold.countDocuments({ tripId: trip._id }).session(session);
        await trip.save({ session });
      }
    });
  } finally {
    await session.endSession();
  }

  res.json({ ok: true, booking });
});

const { asyncHandler } = require("../../middleware/http");
const { Booking, Payment } = require("../../models/shared");
const { syncTripCatalogByTrip } = require("../../services/platform/catalog");
const { reverseBookingPayouts, settleBookingPayouts } = require("../../services/platform/settlements");
const { normalizeProvider } = require("../../services/public/payments");
const { serializePublicBooking } = require("../../services/shared/bookings");
const { credit } = require("../../services/shared/wallet");
const { getTenantAccessByTenantId } = require("../../services/tenant/runtime");
const paymentController = require("./paymentController");

function cleanSeats(seats) {
  return Array.isArray(seats)
    ? seats.map((seat) => String(seat || "").trim()).filter(Boolean)
    : [];
}

async function refreshTripCounts(models, tripId) {
  const { SeatBooking, SeatHold, Trip } = models;
  const [bookedSeats, heldSeats] = await Promise.all([
    SeatBooking.countDocuments({ tripId }),
    SeatHold.countDocuments({ tripId })
  ]);

  await Trip.findByIdAndUpdate(tripId, { bookedSeats, heldSeats });
  return { bookedSeats, heldSeats };
}

exports.confirm = asyncHandler(async (req, res) => {
  const {
    tripId,
    seats,
    paymentProvider = "none",
    referralCode = "",
    useWallet = false
  } = req.body;

  const seatIds = cleanSeats(seats);
  if (!tripId || !seatIds.length) {
    return res.status(400).json({ ok: false, message: "tripId and seats[] required" });
  }

  const provider = paymentProvider === "none"
    ? "mock"
    : normalizeProvider(paymentProvider);

  const checkout = await paymentController.createPendingCheckout({
    publicTripId: tripId,
    seatIds,
    guest: {},
    referralCode,
    useWallet: Boolean(useWallet),
    provider,
    authUser: req.user,
    scopedTenantId: req.tenant?._id || ""
  });

  const finalized = paymentProvider === "none"
    ? await paymentController.finalizePaymentDecision(checkout.payment._id, "success")
    : { booking: checkout.booking, payment: checkout.payment };

  res.status(201).json({
    ok: true,
    booking: serializePublicBooking(finalized.booking),
    payment: finalized.payment,
    checkoutUrl: finalized.payment?.checkoutUrl || ""
  });
});

exports.guestConfirm = asyncHandler(async (req, res) => {
  const { tripId, seats, guest = {}, referralCode = "" } = req.body;
  const seatIds = cleanSeats(seats);
  if (!tripId || !seatIds.length) {
    return res.status(400).json({ ok: false, message: "tripId and seats[] required" });
  }

  const checkout = await paymentController.createPendingCheckout({
    publicTripId: tripId,
    seatIds,
    guest,
    referralCode,
    useWallet: false,
    provider: "mock",
    authUser: null,
    scopedTenantId: req.tenant?._id || ""
  });

  const finalized = await paymentController.finalizePaymentDecision(checkout.payment._id, "success");

  res.status(201).json({
    ok: true,
    booking: serializePublicBooking(finalized.booking),
    payment: finalized.payment
  });
});

exports.myBookings = asyncHandler(async (req, res) => {
  const items = await Booking.find({ userId: req.user.userId })
    .sort("-createdAt")
    .lean();

  res.json({
    ok: true,
    items: items.map(serializePublicBooking)
  });
});

exports.guestLookup = asyncHandler(async (req, res) => {
  const code = String(req.params.lookupCode || "").trim();
  if (!code) return res.status(400).json({ ok: false, message: "lookupCode required" });

  const booking = await Booking.findOne({ guestLookupCode: code }).lean();
  if (!booking) return res.status(404).json({ ok: false, message: "Booking not found" });

  res.json({
    ok: true,
    booking: serializePublicBooking(booking)
  });
});

exports.cancel = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) return res.status(404).json({ ok: false, message: "Booking not found" });

  if (!["admin", "super_admin"].includes(req.user.role) && String(booking.userId) !== String(req.user.userId)) {
    return res.status(403).json({ ok: false, message: "Forbidden" });
  }

  if (["cancelled", "refunded"].includes(booking.status)) {
    return res.json({ ok: true, booking: serializePublicBooking(booking) });
  }

  const { tenant, models } = booking.tenantId
    ? await getTenantAccessByTenantId(booking.tenantId)
    : { tenant: null, models: null };

  if (models) {
    const { SeatBooking } = models;
    await SeatBooking.deleteMany({ bookingId: booking._id });
    await refreshTripCounts(models, booking.tripId);
    if (tenant) {
      await syncTripCatalogByTrip({ tenant, models, tripId: booking.tripId });
    }
  }

  const payment = await Payment.findOne({ bookingId: booking._id }).sort("-createdAt");

  if (booking.walletUsed > 0 && booking.userId) {
    await credit(
      booking.userId,
      booking.walletUsed,
      booking.currency,
      {
        type: "redeem_restore",
        bookingId: booking._id,
        note: "Wallet amount restored after booking cancellation"
      }
    );
  }

  booking.status = booking.paymentStatus === "paid" ? "refunded" : "cancelled";
  booking.paymentStatus = booking.paymentStatus === "paid" ? "refunded" : "cancelled";
  booking.cancellationReason = "Cancelled by customer";
  booking.cancelledAt = new Date();
  booking.cancelledByUserId = req.user.userId;

  await reverseBookingPayouts(booking);

  if (payment) {
    payment.status = booking.paymentStatus === "refunded" ? "refunded" : "cancelled";
    payment.failureReason = booking.cancellationReason;
    payment.metadata = {
      ...(payment.metadata || {}),
      cancelledByUserId: req.user.userId,
      cancellationSource: "public_booking_cancel"
    };
    await payment.save();
  }

  await booking.save();

  res.json({ ok: true, booking: serializePublicBooking(booking) });
});

/**
 * POST /api/public/bookings/:id/complete
 * Marks a checked-in booking as "completed" and releases pending earnings to
 * the company and promoter wallets. Only callable by company employees / admins.
 */
exports.complete = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) return res.status(404).json({ ok: false, message: "Booking not found" });

  if (booking.status !== "confirmed") {
    return res.status(400).json({ ok: false, message: `Cannot complete a booking with status: ${booking.status}` });
  }
  if (booking.checkInStatus !== "checked_in") {
    return res.status(400).json({ ok: false, message: "Booking must be checked in before it can be completed" });
  }

  booking.status = "completed";
  booking.completedAt = new Date();
  await booking.save();

  let settled = null;
  try {
    settled = await settleBookingPayouts(booking);
  } catch (settleErr) {
    console.error("[booking.complete] settlement error:", settleErr.message);
  }

  res.json({ ok: true, booking: serializePublicBooking(booking), settled });
});

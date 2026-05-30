const mongoose = require("mongoose");
const { asyncHandler } = require("../../middleware/http");
const { Booking, Payment, User } = require("../../models/shared");
const { catalogMatchesTenantScope, getTenantAccessByCatalog, getTenantAccessByTenantId } = require("../../services/tenant/runtime");
const { syncTripCatalogByTrip } = require("../../services/platform/catalog");
const { createCheckoutPayload, normalizeProvider } = require("../../services/public/payments");
const { settleBookingPayouts } = require("../../services/platform/settlements");
const { serializePublicBooking } = require("../../services/shared/bookings");
const { credit, redeem } = require("../../services/shared/wallet");

function cleanSeats(seats) {
  return Array.isArray(seats)
    ? seats.map((seat) => String(seat || "").trim()).filter(Boolean)
    : [];
}

function makeLookupCode() {
  return `GT-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

function normalizeGuest(guest = {}) {
  return {
    name: String(guest?.name || "").trim(),
    email: String(guest?.email || "").trim().toLowerCase(),
    phone: String(guest?.phone || "").trim()
  };
}

async function resolveReferral(referralCode) {
  const code = String(referralCode || "").trim();
  if (!code) return { code: "", user: null, percent: 0 };

  const user = await User.findOne({ referralCode: code })
    .select("_id referralCode")
    .lean();

  if (!user) return { code, user: null, percent: 0 };
  return { code: user.referralCode, user, percent: 3 };
}

function validateSeatIds(vehicle, seatIds) {
  const knownSeatIds = new Set(
    (vehicle?.seats || [])
      .map((seat) => String(seat.id || seat.seatId || seat.label || "").trim())
      .filter(Boolean)
  );

  if (!knownSeatIds.size) return;

  const invalidSeats = seatIds.filter((seatId) => !knownSeatIds.has(seatId));
  if (invalidSeats.length) {
    const err = new Error(`Invalid seat selection: ${invalidSeats.join(", ")}`);
    err.statusCode = 400;
    throw err;
  }
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

async function createPendingCheckout({
  publicTripId,
  seatIds,
  guest,
  referralCode,
  useWallet,
  provider,
  authUser,
  scopedTenantId = ""
}) {
  const { catalog, tenant, models } = await getTenantAccessByCatalog(publicTripId);
  if (!catalog || !tenant || !models || !catalogMatchesTenantScope(catalog, scopedTenantId)) {
    const err = new Error("Trip not available");
    err.statusCode = 404;
    throw err;
  }

  const { SeatBooking, SeatHold, Trip, Route, Vehicle } = models;
  const trip = await Trip.findById(catalog.sourceTripId);
  if (!trip || trip.status !== "scheduled") {
    const err = new Error("Trip not available");
    err.statusCode = 404;
    throw err;
  }

  const [route, vehicle] = await Promise.all([
    trip.routeId ? Route.findById(trip.routeId).lean() : Promise.resolve(null),
    trip.vehicleId ? Vehicle.findById(trip.vehicleId).lean() : Promise.resolve(null)
  ]);

  if (!vehicle) {
    const err = new Error("Vehicle not available");
    err.statusCode = 404;
    throw err;
  }

  validateSeatIds(vehicle, seatIds);

  const bookedCount = await SeatBooking.countDocuments({
    tripId: trip._id,
    seatId: { $in: seatIds }
  });
  if (bookedCount) {
    const err = new Error("Some seats are already booked");
    err.statusCode = 409;
    throw err;
  }

  const holds = await SeatHold.find({
    tripId: trip._id,
    seatId: { $in: seatIds }
  })
    .select("seatId userId")
    .lean();

  const blocked = holds.filter((hold) => {
    if (!authUser) return true;
    return String(hold.userId) !== String(authUser.userId);
  });

  if (blocked.length) {
    const err = new Error("Some seats are temporarily held. Please choose different seats.");
    err.statusCode = 409;
    throw err;
  }

  const bookingId = new Booking()._id;
  const normalizedGuest = normalizeGuest(guest);

  if (!authUser && !normalizedGuest.name && !normalizedGuest.email && !normalizedGuest.phone) {
    const err = new Error("Guest name, email, or phone is required");
    err.statusCode = 400;
    throw err;
  }

  let walletUsed = 0;
  let seatRowsCreated = false;

  try {
    await SeatBooking.create(
      seatIds.map((seatId) => ({
        tripId: trip._id,
        seatId,
        bookingId
      }))
    );
    seatRowsCreated = true;

    if (authUser) {
      await SeatHold.deleteMany({
        tripId: trip._id,
        userId: authUser.userId,
        seatId: { $in: seatIds }
      });
    }

    const baseAmount = Number(trip.basePrice || 0) * seatIds.length;
    if (authUser && useWallet) {
      const redemption = await redeem(
        authUser.userId,
        baseAmount,
        trip.currency,
        {
          type: "redeem_debit",
          bookingId,
          note: "Wallet redemption reserved during checkout"
        }
      );
      walletUsed = redemption.used || 0;
    }

    const amount = Math.max(0, baseAmount - walletUsed);
    const ref = await resolveReferral(referralCode);

    const booking = await Booking.create({
      _id: bookingId,
      userId: authUser?.userId || null,
      guest: authUser ? undefined : normalizedGuest,
      guestLookupCode: authUser ? "" : makeLookupCode(),
      ownerId: trip.ownerId,
      tenantId: tenant._id,
      tenantSlug: tenant.slug,
      tripCatalogId: catalog._id,
      tripId: trip._id,
      serviceName: catalog.title || route?.title || "",
      serviceType: catalog.type || route?.type || "bus",
      serviceFrom: catalog.from || route?.from || route?.city || "",
      serviceTo: catalog.to || route?.to || route?.city || "",
      serviceAddress: catalog.address || route?.address || "",
      vehicleName: catalog.vehicle?.name || vehicle?.name || "",
      travelDate: trip.departureAt,
      seats: seatIds.map((seatId) => ({ seatId, price: trip.basePrice })),
      quantity: seatIds.length,
      amount,
      grossAmount: baseAmount,
      currency: trip.currency,
      walletUsed,
      referralCode: ref.code || "",
      referralUserId: ref.user?._id || null,
      referralPercent: ref.percent || 0,
      status: "pending_payment",
      paymentStatus: "pending",
      paymentProvider: provider,
      settlementStatus: "pending"
    });

    const payment = await Payment.create({
      bookingId: booking._id,
      userId: authUser?.userId || null,
      ownerId: trip.ownerId,
      provider,
      providerReference: `PENDING-${booking._id.toString().slice(-10).toUpperCase()}`,
      amount,
      currency: trip.currency,
      metadata: {
        guest: authUser ? null : normalizedGuest,
        seats: seatIds,
        tenantId: String(tenant._id),
        tenantSlug: tenant.slug,
        tripCatalogId: String(catalog._id),
        sourceTripId: String(trip._id),
        serviceName: catalog.title || route?.title || ""
      }
    });

    const checkout = createCheckoutPayload(payment, provider);
    payment.providerReference = checkout.providerReference;
    payment.checkoutUrl = checkout.checkoutUrl;
    await payment.save();

    const refreshedTripCounts = await refreshTripCounts(models, trip._id);
    const refreshedTrip = await Trip.findById(trip._id).lean();
    await syncTripCatalogByTrip({ tenant, models, tripId: trip._id });

    return {
      booking,
      payment,
      trip: {
        _id: String(catalog._id),
        departureAt: trip.departureAt,
        bookedSeats: Number(refreshedTripCounts.bookedSeats || refreshedTrip?.bookedSeats || 0),
        heldSeats: Number(refreshedTripCounts.heldSeats || refreshedTrip?.heldSeats || 0)
      }
    };
  } catch (error) {
    if (walletUsed > 0 && authUser?.userId) {
      await credit(
        authUser.userId,
        walletUsed,
        trip.currency,
        {
          type: "redeem_restore",
          bookingId,
          note: "Wallet amount restored after checkout error"
        }
      ).catch(() => {});
    }

    if (seatRowsCreated) {
      await SeatBooking.deleteMany({ bookingId }).catch(() => {});
      await refreshTripCounts(models, trip._id).catch(() => {});
      await syncTripCatalogByTrip({ tenant, models, tripId: trip._id }).catch(() => {});
    }

    throw error;
  }
}

async function finalizePaymentDecision(paymentId, decision) {
  if (!mongoose.Types.ObjectId.isValid(paymentId)) {
    const err = new Error("Invalid payment id");
    err.statusCode = 400;
    throw err;
  }

  const payment = await Payment.findById(paymentId);
  if (!payment) {
    const err = new Error("Payment not found");
    err.statusCode = 404;
    throw err;
  }

  const booking = await Booking.findById(payment.bookingId);
  if (!booking) {
    const err = new Error("Booking not found");
    err.statusCode = 404;
    throw err;
  }

  if (payment.status === "succeeded") {
    return { payment, booking, decision: "success", alreadyFinalized: true };
  }

  if (["failed", "cancelled", "refunded"].includes(payment.status)) {
    return { payment, booking, decision, alreadyFinalized: true };
  }

  const access = booking.tenantId
    ? await getTenantAccessByTenantId(booking.tenantId)
    : { tenant: null, models: null };
  const { tenant, models } = access;

  if (decision === "success") {
    payment.status = "succeeded";
    payment.paidAt = new Date();
    payment.failureReason = "";

    booking.status = "confirmed";
    booking.paymentStatus = "paid";
    booking.paymentProvider = payment.provider;
    booking.paymentRef = payment.providerReference;

    await settleBookingPayouts(booking);
  } else {
    payment.status = decision === "cancel" ? "cancelled" : "failed";
    payment.failureReason = decision === "cancel"
      ? "Customer cancelled checkout"
      : "Mock payment failed";

    booking.status = "cancelled";
    booking.paymentStatus = decision === "cancel" ? "cancelled" : "failed";
    booking.cancellationReason = payment.failureReason;
    booking.cancelledAt = new Date();
    booking.cancelledByUserId = booking.userId || null;

    if (booking.walletUsed > 0 && booking.userId) {
      await credit(
        booking.userId,
        booking.walletUsed,
        booking.currency,
        {
          type: "redeem_restore",
          bookingId: booking._id,
          note: "Wallet amount restored after failed checkout"
        }
      );
    }

    if (models) {
      const { SeatBooking } = models;
      await SeatBooking.deleteMany({ bookingId: booking._id });
      await refreshTripCounts(models, booking.tripId);
      if (tenant) {
        await syncTripCatalogByTrip({ tenant, models, tripId: booking.tripId });
      }
    }
  }

  await Promise.all([payment.save(), booking.save()]);

  return { payment, booking, decision };
}

exports.createPendingCheckout = createPendingCheckout;
exports.finalizePaymentDecision = finalizePaymentDecision;

exports.checkout = asyncHandler(async (req, res) => {
  const {
    tripId,
    seats,
    guest = {},
    referralCode = "",
    useWallet = false,
    provider = "mock"
  } = req.body;

  const seatIds = cleanSeats(seats);
  if (!tripId || !seatIds.length) {
    return res.status(400).json({ ok: false, message: "tripId and seats[] are required" });
  }

  const authUser = req.user || null;
  const result = await createPendingCheckout({
    publicTripId: tripId,
    seatIds,
    guest,
    referralCode,
    useWallet: Boolean(useWallet),
    provider: normalizeProvider(provider),
    authUser,
    scopedTenantId: req.tenant?._id || ""
  });

  res.status(201).json({
    ok: true,
    booking: serializePublicBooking(result.booking),
    payment: result.payment,
    checkoutUrl: result.payment.checkoutUrl,
    trip: result.trip
  });
});

exports.mockComplete = asyncHandler(async (req, res) => {
  const decision = String(req.body?.status || req.query?.status || "success")
    .trim()
    .toLowerCase();
  const normalizedDecision = decision === "success"
    ? "success"
    : decision === "cancel"
      ? "cancel"
      : "failed";
  const result = await finalizePaymentDecision(req.params.paymentId, normalizedDecision);

  res.json({
    ok: true,
    decision: result.decision,
    booking: serializePublicBooking(result.booking),
    payment: result.payment,
    alreadyFinalized: Boolean(result.alreadyFinalized)
  });
});

exports.getOne = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.paymentId)) {
    return res.status(400).json({ ok: false, message: "Invalid payment id" });
  }

  const payment = await Payment.findById(req.params.paymentId)
    .populate("bookingId")
    .lean();
  if (!payment) return res.status(404).json({ ok: false, message: "Payment not found" });

  res.json({
    ok: true,
    payment: {
      ...payment,
      bookingId: payment.bookingId ? serializePublicBooking(payment.bookingId) : null
    }
  });
});

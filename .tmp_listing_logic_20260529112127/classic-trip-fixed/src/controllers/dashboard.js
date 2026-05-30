const mongoose = require("mongoose");

const asyncHandler = require("../middleware/asyncHandler");
const Booking = require("../models/booking");
const Route = require("../models/route");
const Trip = require("../models/trip");
const User = require("../models/user");
const Vehicle = require("../models/vehicle");
const Wallet = require("../models/wallet");
const WalletTxn = require("../models/walletTxn");

function toObjectId(value) {
  return new mongoose.Types.ObjectId(String(value));
}

function resolveCompanyOwnerId(user, ownerIdOverride = "") {
  if ((user.role === "admin" || user.role === "super_admin") && ownerIdOverride) {
    return String(ownerIdOverride);
  }
  return String(user.companyId || user.userId);
}

function startOfDay(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function endOfDay(date = new Date()) {
  const value = new Date(date);
  value.setHours(23, 59, 59, 999);
  return value;
}

function computeSplit(amount, referralPercent, hasPromoter) {
  const gross = Number(amount || 0);
  const promoterPercent = Number(referralPercent || 0);
  const promoterAmount = Math.round(gross * (promoterPercent / 100));
  const platformPercent = hasPromoter ? 7 : 10;
  const platformAmount = Math.round(gross * (platformPercent / 100));
  const companyAmount = Math.max(0, gross - promoterAmount - platformAmount);

  return {
    promoterPercent,
    promoterAmount,
    platformPercent,
    platformAmount,
    companyAmount
  };
}

function mapTrip(trip) {
  const route = trip.routeId || {};
  const vehicle = trip.vehicleId || {};
  return {
    _id: trip._id,
    title: route.title || `${route.from || ""} to ${route.to || ""}`.trim() || "Scheduled service",
    type: route.type || "trip",
    departureAt: trip.departureAt,
    arriveAt: trip.arriveAt,
    currency: trip.currency,
    basePrice: trip.basePrice,
    totalSeats: trip.totalSeats,
    bookedSeats: trip.bookedSeats,
    heldSeats: trip.heldSeats,
    remainingSeats: Math.max(0, Number(trip.totalSeats || 0) - Number(trip.bookedSeats || 0) - Number(trip.heldSeats || 0)),
    vehicleName: vehicle.name || "",
    vehicleType: vehicle.type || ""
  };
}

function mapBooking(booking) {
  const trip = booking.tripId || {};
  const route = trip.routeId || {};
  const owner = booking.ownerId || {};
  const user = booking.userId || {};
  const promoter = booking.referralUserId || {};
  const split = computeSplit(booking.amount, booking.referralPercent, Boolean(booking.referralUserId));

  return {
    _id: booking._id,
    code: booking.guestLookupCode || String(booking._id).slice(-8).toUpperCase(),
    customer: user.name || booking.guest?.name || "Guest customer",
    contact: user.email || user.phone || booking.guest?.email || booking.guest?.phone || "",
    service: route.title || "Trip",
    type: route.type || "trip",
    company: owner.name || "Company",
    seats: (booking.seats || []).map((seat) => seat.seatId).join(", "),
    travelDate: booking.travelDate,
    amount: booking.amount,
    currency: booking.currency,
    status: booking.status,
    referralCode: booking.referralCode || "",
    promoter: promoter.name || "",
    promoterCommission: split.promoterAmount,
    platformCommission: split.platformAmount,
    companyAmount: split.companyAmount,
    createdAt: booking.createdAt
  };
}

async function revenueAgg(match = {}) {
  return Booking.aggregate([
    { $match: { status: "confirmed", ...match } },
    { $group: { _id: "$currency", total: { $sum: "$amount" }, bookings: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);
}

async function recentBookings(filter, limit = 12) {
  const items = await Booking.find(filter)
    .populate({ path: "tripId", populate: [{ path: "routeId" }, { path: "vehicleId", select: "name type layoutName totalSeats" }] })
    .populate("userId", "name email phone role")
    .populate("ownerId", "name email phone role")
    .populate("referralUserId", "name email phone referralCode role")
    .sort("-createdAt")
    .limit(limit)
    .lean();

  return items.map(mapBooking);
}

async function walletSnapshot(userId, limit = 12) {
  const [wallet, txns] = await Promise.all([
    Wallet.findOne({ userId }).lean(),
    WalletTxn.find({ userId }).sort("-createdAt").limit(limit).lean()
  ]);

  return {
    wallet: wallet || { balance: 0, currency: "UGX" },
    txns
  };
}

async function inventoryMix(match = {}) {
  return Route.aggregate([
    { $match: match },
    { $group: { _id: "$type", count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);
}

async function topCompanies(limit = 6) {
  const rows = await Booking.aggregate([
    { $match: { status: "confirmed" } },
    { $group: { _id: "$ownerId", bookings: { $sum: 1 }, revenue: { $sum: "$amount" } } },
    { $sort: { revenue: -1 } },
    { $limit: limit }
  ]);

  const ids = rows.map((row) => row._id).filter(Boolean);
  const users = await User.find({ _id: { $in: ids } }).select("name email role").lean();
  const byId = new Map(users.map((user) => [String(user._id), user]));

  return rows.map((row) => ({
    companyId: row._id,
    name: byId.get(String(row._id))?.name || "Company",
    email: byId.get(String(row._id))?.email || "",
    bookings: row.bookings,
    revenue: row.revenue
  }));
}

async function topPromoters(limit = 6) {
  const rows = await Booking.find({
    status: "confirmed",
    referralUserId: { $ne: null }
  })
    .select("referralUserId referralPercent amount")
    .lean();

  const grouped = new Map();
  rows.forEach((booking) => {
    const key = String(booking.referralUserId);
    const current = grouped.get(key) || { bookings: 0, earned: 0 };
    const split = computeSplit(booking.amount, booking.referralPercent, true);
    current.bookings += 1;
    current.earned += split.promoterAmount;
    grouped.set(key, current);
  });

  const entries = [...grouped.entries()]
    .sort((a, b) => b[1].earned - a[1].earned)
    .slice(0, limit);

  const ids = entries.map(([id]) => id);
  const users = await User.find({ _id: { $in: ids } }).select("name email referralCode").lean();
  const byId = new Map(users.map((user) => [String(user._id), user]));

  return entries.map(([id, stats]) => ({
    promoterId: id,
    name: byId.get(id)?.name || "Promoter",
    email: byId.get(id)?.email || "",
    referralCode: byId.get(id)?.referralCode || "",
    bookings: stats.bookings,
    earned: stats.earned
  }));
}

exports.superAdmin = asyncHandler(async (req, res) => {
  const [stats, revenue, bookings, recentUsers, companies, promoters, mix, walletInfo] = await Promise.all([
    Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: { $in: ["company_admin", "partner"] } }),
      User.countDocuments({ role: "company_employee" }),
      User.countDocuments({ role: "customer" }),
      User.countDocuments({ role: "promoter" }),
      Route.countDocuments({ isActive: true }),
      Vehicle.countDocuments(),
      Trip.countDocuments({ status: "scheduled" }),
      Booking.countDocuments(),
      Booking.countDocuments({ status: "confirmed" }),
      Booking.countDocuments({ userId: null }),
      Booking.countDocuments({ referralUserId: { $ne: null } })
    ]),
    revenueAgg(),
    recentBookings({}, 14),
    User.find().select("name email role status companyId createdAt").sort("-createdAt").limit(10).lean(),
    topCompanies(6),
    topPromoters(6),
    inventoryMix({ isActive: true }),
    walletSnapshot(req.user.userId, 10)
  ]);

  const [
    users,
    companyAdmins,
    companyEmployees,
    customers,
    promoterUsers,
    activeListings,
    vehicles,
    liveTrips,
    totalBookings,
    confirmedBookings,
    guestBookings,
    referredBookings
  ] = stats;

  res.json({
    ok: true,
    stats: {
      users,
      companyAdmins,
      companyEmployees,
      customers,
      promoterUsers,
      activeListings,
      vehicles,
      liveTrips,
      totalBookings,
      confirmedBookings,
      guestBookings,
      referredBookings,
      revenue,
      walletBalance: walletInfo.wallet.balance || 0,
      walletCurrency: walletInfo.wallet.currency || "UGX"
    },
    bookingRows: bookings,
    recentUsers,
    companyLeaders: companies,
    promoterLeaders: promoters,
    inventoryMix: mix,
    wallet: walletInfo.wallet,
    walletTxns: walletInfo.txns
  });
});

exports.companyAdmin = asyncHandler(async (req, res) => {
  const ownerId = resolveCompanyOwnerId(req.user, req.query.ownerId);
  const ownerObjectId = toObjectId(ownerId);

  const [company, stats, revenue, bookings, trips, employees, walletInfo, mix] = await Promise.all([
    User.findById(ownerId).select("name email phone role status").lean(),
    Promise.all([
      Route.countDocuments({ ownerId }),
      Vehicle.countDocuments({ ownerId }),
      Trip.countDocuments({ ownerId, status: "scheduled" }),
      Trip.countDocuments({ ownerId, status: "scheduled", departureAt: { $gte: new Date() } }),
      Booking.countDocuments({ ownerId }),
      Booking.countDocuments({ ownerId, status: "confirmed" }),
      Booking.countDocuments({ ownerId, userId: null }),
      Booking.countDocuments({ ownerId, referralUserId: { $ne: null } })
    ]),
    revenueAgg({ ownerId: ownerObjectId }),
    recentBookings({ ownerId }, 14),
    Trip.find({ ownerId, status: "scheduled" })
      .populate("routeId")
      .populate("vehicleId", "name type totalSeats")
      .sort("departureAt")
      .limit(10)
      .lean(),
    User.find({ companyId: ownerObjectId, role: "company_employee" })
      .select("name email phone status createdAt")
      .sort("-createdAt")
      .lean(),
    walletSnapshot(ownerId, 10),
    inventoryMix({ ownerId: ownerObjectId })
  ]);

  const [listings, vehicles, scheduledTrips, upcomingTrips, totalBookings, confirmedBookings, guestBookings, referredSales] = stats;

  res.json({
    ok: true,
    company,
    stats: {
      listings,
      vehicles,
      scheduledTrips,
      upcomingTrips,
      totalBookings,
      confirmedBookings,
      guestBookings,
      referredSales,
      revenue,
      walletBalance: walletInfo.wallet.balance || 0,
      walletCurrency: walletInfo.wallet.currency || "UGX"
    },
    bookingRows: bookings,
    activeTrips: trips.map(mapTrip),
    employees,
    wallet: walletInfo.wallet,
    walletTxns: walletInfo.txns,
    inventoryMix: mix
  });
});

exports.companyEmployee = asyncHandler(async (req, res) => {
  const ownerId = resolveCompanyOwnerId(req.user, req.query.ownerId);
  const ownerObjectId = toObjectId(ownerId);
  const todayStart = startOfDay();
  const todayEnd = endOfDay();

  const [employee, company, stats, todayTrips, bookingRows] = await Promise.all([
    User.findById(req.user.userId).select("name email phone role status companyId").lean(),
    User.findById(ownerId).select("name email phone role status").lean(),
    Promise.all([
      Trip.countDocuments({ ownerId, status: "scheduled", departureAt: { $gte: todayStart, $lte: todayEnd } }),
      Trip.countDocuments({ ownerId, status: "scheduled", departureAt: { $gte: new Date() } }),
      Booking.countDocuments({ ownerId, status: "confirmed" }),
      Booking.countDocuments({ ownerId, status: "pending_payment" })
    ]),
    Trip.find({ ownerId, status: "scheduled", departureAt: { $gte: todayStart, $lte: todayEnd } })
      .populate("routeId")
      .populate("vehicleId", "name type totalSeats")
      .sort("departureAt")
      .limit(12)
      .lean(),
    recentBookings({
      ownerId,
      status: { $in: ["confirmed", "pending_payment"] }
    }, 18)
  ]);

  const [todayTripCount, futureTrips, confirmedBookings, pendingPayments] = stats;

  res.json({
    ok: true,
    employee,
    company,
    stats: {
      todayTripCount,
      futureTrips,
      confirmedBookings,
      pendingPayments
    },
    bookingRows,
    todayTrips: todayTrips.map(mapTrip),
    operationNotes: [
      "Check booking codes before boarding or room access.",
      "Use occupancy and manifest views for same-day operations.",
      "Escalate payment disputes or refund requests to company admin."
    ]
  });
});

exports.customer = asyncHandler(async (req, res) => {
  const [customer, walletInfo, bookingRows, stats] = await Promise.all([
    User.findById(req.user.userId).select("name email phone role status referralCode").lean(),
    walletSnapshot(req.user.userId, 12),
    recentBookings({ userId: req.user.userId }, 16),
    Promise.all([
      Booking.countDocuments({ userId: req.user.userId }),
      Booking.countDocuments({ userId: req.user.userId, status: "confirmed", travelDate: { $gte: new Date() } }),
      Booking.countDocuments({ userId: req.user.userId, status: "cancelled" })
    ])
  ]);

  const [totalBookings, upcomingBookings, cancelledBookings] = stats;
  const upcomingRows = bookingRows.filter((booking) => new Date(booking.travelDate) >= new Date()).slice(0, 6);

  res.json({
    ok: true,
    customer,
    stats: {
      totalBookings,
      upcomingBookings,
      cancelledBookings,
      walletBalance: walletInfo.wallet.balance || 0,
      walletCurrency: walletInfo.wallet.currency || "UGX"
    },
    bookingRows,
    upcomingRows,
    wallet: walletInfo.wallet,
    walletTxns: walletInfo.txns
  });
});

exports.promoter = asyncHandler(async (req, res) => {
  const [promoter, walletInfo, bookingRows, promotableTrips] = await Promise.all([
    User.findById(req.user.userId).select("name email phone role status referralCode").lean(),
    walletSnapshot(req.user.userId, 12),
    recentBookings({ referralUserId: req.user.userId }, 20),
    Trip.find({ status: "scheduled", departureAt: { $gte: new Date() } })
      .populate("routeId")
      .populate("vehicleId", "name type totalSeats")
      .sort("departureAt")
      .limit(8)
      .lean()
  ]);

  const totalEarned = bookingRows.reduce((sum, booking) => sum + Number(booking.promoterCommission || 0), 0);
  const directShareLinks = promotableTrips.map((trip) => ({
    tripId: trip._id,
    title: trip.routeId?.title || `${trip.routeId?.from || ""} to ${trip.routeId?.to || ""}`.trim() || "Trip",
    type: trip.routeId?.type || "trip",
    shareUrl: `${req.protocol}://${req.get("host")}/trip/${trip._id}?ref=${encodeURIComponent(promoter?.referralCode || "")}`
  }));

  res.json({
    ok: true,
    promoter,
    stats: {
      referredBookings: bookingRows.length,
      totalEarned,
      walletBalance: walletInfo.wallet.balance || 0,
      walletCurrency: walletInfo.wallet.currency || "UGX",
      activeShareLinks: directShareLinks.length
    },
    bookingRows,
    wallet: walletInfo.wallet,
    walletTxns: walletInfo.txns,
    shareLinks: directShareLinks
  });
});

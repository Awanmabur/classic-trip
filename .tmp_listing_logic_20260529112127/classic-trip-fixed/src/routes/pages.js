const router = require("express").Router();
const Trip = require("../models/trip");

async function featuredTrips(type, limit = 8) {
  return Trip.find({ status: "scheduled" })
    .populate({ path: "routeId", match: { type, isActive: true } })
    .populate("vehicleId", "name type layoutName rows cols totalSeats images")
    .sort({ departureAt: 1 })
    .limit(40)
    .lean()
    .then((items) => items.filter((item) => item.routeId).slice(0, limit));
}

const dashboardSections = {
  super: {
    title: "Super Admin Dashboard",
    subtitle: "Control companies, users, payouts, listings, tickets, reporting, and platform health.",
    roleNote: "Full platform access across every company, customer, promoter, booking, payout, and role assignment.",
    sections: [
      { id: "overview", icon: "01", label: "Overview" },
      { id: "activity", icon: "02", label: "Activity" },
      { id: "bookings", icon: "03", label: "Bookings" },
      { id: "finance", icon: "04", label: "Finance" },
      { id: "tools", icon: "05", label: "Tools" }
    ]
  },
  companyAdmin: {
    title: "Company Admin Dashboard",
    subtitle: "Run your company inventory, staff, schedules, manifests, sales, and operator payouts.",
    roleNote: "Company admin controls only their own company data, employees, services, trips, and operating reports.",
    sections: [
      { id: "overview", icon: "01", label: "Overview" },
      { id: "activity", icon: "02", label: "Operations" },
      { id: "bookings", icon: "03", label: "Bookings" },
      { id: "finance", icon: "04", label: "Finance" },
      { id: "tools", icon: "05", label: "Tools" }
    ]
  },
  employee: {
    title: "Company Employee Dashboard",
    subtitle: "Handle daily operations, passenger manifests, seat availability, and ticket verification.",
    roleNote: "Employee access is scoped to assigned company operations and day-to-day execution.",
    sections: [
      { id: "overview", icon: "01", label: "Overview" },
      { id: "activity", icon: "02", label: "Trips" },
      { id: "bookings", icon: "03", label: "Manifest" },
      { id: "finance", icon: "04", label: "Ops Notes" },
      { id: "tools", icon: "05", label: "Tools" }
    ]
  },
  customer: {
    title: "Customer Dashboard",
    subtitle: "See tickets, future trips, wallet balance, booking history, and support-ready details.",
    roleNote: "Customer dashboards are optional because guest checkout exists, but accounts give you history and wallet access.",
    sections: [
      { id: "overview", icon: "01", label: "Overview" },
      { id: "activity", icon: "02", label: "Upcoming" },
      { id: "bookings", icon: "03", label: "Bookings" },
      { id: "finance", icon: "04", label: "Wallet" },
      { id: "tools", icon: "05", label: "Tools" }
    ]
  },
  promoter: {
    title: "Promoter Dashboard",
    subtitle: "Share inventory, track referrals, monitor commissions, and grow your promoter wallet.",
    roleNote: "Promoters earn 3% when confirmed bookings come through their referral link.",
    sections: [
      { id: "overview", icon: "01", label: "Overview" },
      { id: "activity", icon: "02", label: "Referral Links" },
      { id: "bookings", icon: "03", label: "Sales" },
      { id: "finance", icon: "04", label: "Earnings" },
      { id: "tools", icon: "05", label: "Tools" }
    ]
  }
};

function dashboardPage(type) {
  return (_req, res) => res.render("pages/dashboards", { dashboardType: type, ...dashboardSections[type] });
}

router.get("/", async (req, res, next) => {
  try {
    const [buses, hotels, flights, trains] = await Promise.all([
      featuredTrips("bus"),
      featuredTrips("hotel"),
      featuredTrips("flight"),
      featuredTrips("train")
    ]);

    res.render("pages/home", { buses, hotels, flights, trains });
  } catch (err) {
    next(err);
  }
});

router.get("/search", (req, res) => res.render("pages/search"));
router.get("/trip/:id", (req, res) => res.render("pages/trip", { tripId: req.params.id }));

router.get("/login", (req, res) => res.render("pages/login"));
router.get("/register", (req, res) => res.render("pages/register"));
router.get("/logout", (req, res) => res.render("pages/logout"));

router.get("/dashboard", (req, res) => res.render("pages/dashboard_redirect"));
router.get("/customer-dashboard", dashboardPage("customer"));
router.get("/promoter-dashboard", dashboardPage("promoter"));
router.get("/company-admin", dashboardPage("companyAdmin"));
router.get("/company-employee", dashboardPage("employee"));
router.get("/super-admin", dashboardPage("super"));

router.get("/me/bookings", (req, res) => res.render("pages/my_bookings"));
router.get("/wallet", (req, res) => res.render("pages/wallet"));
router.get("/guest/booking/:code", (req, res) => res.render("pages/guest_booking", { code: req.params.code }));

router.get("/partner", (req, res) => res.render("pages/partner/dashboard"));
router.get("/partner/vehicles/new", (req, res) => res.render("pages/partner/vehicle_new"));
router.get("/partner/route/new", (req, res) => res.render("pages/partner/route_new"));
router.get("/partner/routes/new", (req, res) => res.render("pages/partner/route_new"));
router.get("/partner/trips/new", (req, res) => res.render("pages/partner/trip_new"));
router.get("/partner/trips/:id/occupancy", (req, res) => res.render("pages/partner/occupancy", { tripId: req.params.id }));
router.get("/partner/trips/:id/manifest", (req, res) => res.render("pages/partner/manifest", { tripId: req.params.id }));

router.get("/admin", (req, res) => res.render("pages/admin/dashboard"));
router.get("/admin/users", (req, res) => res.render("pages/admin/users"));
router.get("/admin/bookings", (req, res) => res.render("pages/admin/bookings"));

module.exports = router;

const router = require("express").Router();

router.get("/", (req, res) => res.render("pages/home"));
router.get("/search", (req, res) => res.render("pages/search"));
router.get("/trip/:id", (req, res) => res.render("pages/trip", { tripId: req.params.id }));

router.get("/login", (req, res) => res.render("pages/login"));
router.get("/register", (req, res) => res.render("pages/register"));
router.get("/logout", (req, res) => res.render("pages/logout"));

router.get("/me/bookings", (req, res) => res.render("pages/my_bookings"));
router.get("/wallet", (req, res) => res.render("pages/wallet"));
router.get("/guest/booking/:code", (req, res) => res.render("pages/guest_booking", { code: req.params.code }));

// Partner pages
router.get("/partner", (req, res) => res.render("pages/partner/dashboard"));
router.get("/partner/vehicles/new", (req, res) => res.render("pages/partner/vehicle_new"));
router.get("/partner/route/new", (req, res) => res.render("pages/partner/route_new"));
router.get("/partner/trips/new", (req, res) => res.render("pages/partner/trip_new"));
router.get("/partner/trips/:id/occupancy", (req, res) => res.render("pages/partner/occupancy", { tripId: req.params.id }));
router.get("/partner/trips/:id/manifest", (req, res) => res.render("pages/partner/manifest", { tripId: req.params.id }));

// Admin pages
router.get("/admin", (req, res) => res.render("pages/admin/dashboard"));
router.get("/admin/users", (req, res) => res.render("pages/admin/users"));
router.get("/admin/bookings", (req, res) => res.render("pages/admin/bookings"));

module.exports = router;

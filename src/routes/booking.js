const router = require("express").Router();
const ctrl = require("../controllers/booking");
const { auth, optionalAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/roles");

// Logged-in customers: seat holds + wallet usage + referral tracking
router.post("/confirm", auth, requireRole("customer", "admin"), ctrl.confirm);

// Guest checkout (no login): direct booking if seats are free (not booked and not held)
router.post("/guest/confirm", optionalAuth, ctrl.guestConfirm);

// View bookings
router.get("/me", auth, requireRole("customer", "admin"), ctrl.myBookings);
router.get("/guest/:lookupCode", ctrl.guestLookup);

// Cancel (customer/admin)
router.patch("/:id/cancel", auth, requireRole("customer", "admin"), ctrl.cancel);

module.exports = router;

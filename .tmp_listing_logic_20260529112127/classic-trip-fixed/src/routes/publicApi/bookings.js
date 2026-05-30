const router = require("express").Router();
const ctrl = require("../../controllers/public/bookingController");
const { auth, optionalAuth, requireRole } = require("../../middleware/auth");

router.post("/confirm", auth, requireRole("customer", "promoter", "admin", "super_admin"), ctrl.confirm);
router.post("/guest/confirm", optionalAuth, ctrl.guestConfirm);
router.get("/me", auth, requireRole("customer", "promoter", "admin", "super_admin"), ctrl.myBookings);
router.get("/guest/:lookupCode", ctrl.guestLookup);
router.patch("/:id/cancel", auth, requireRole("customer", "promoter", "admin", "super_admin"), ctrl.cancel);
router.post(
  "/:id/complete",
  auth,
  requireRole("company_employee", "company_admin", "partner", "admin", "super_admin"),
  ctrl.complete
);

module.exports = router;

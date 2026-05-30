const router = require("express").Router();
const ctrl = require("../../controllers/tenant/partnerController");
const { auth, requireRole } = require("../../middleware/auth");

router.get("/dashboard", auth, requireRole("partner", "company_admin", "company_employee", "admin", "super_admin"), ctrl.dashboard);
router.get("/trips/:tripId/occupancy", auth, requireRole("partner", "company_admin", "company_employee", "admin", "super_admin"), ctrl.tripOccupancy);
router.get("/trips/:tripId/manifest", auth, requireRole("partner", "company_admin", "company_employee", "admin", "super_admin"), ctrl.tripManifest);

module.exports = router;

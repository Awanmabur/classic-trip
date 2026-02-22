const router = require("express").Router();
const ctrl = require("../controllers/partner");
const { auth } = require("../middleware/auth");
const { requireRole } = require("../middleware/roles");

router.get("/dashboard", auth, requireRole("partner", "admin"), ctrl.dashboard);
router.get("/trips/:tripId/occupancy", auth, requireRole("partner", "admin"), ctrl.tripOccupancy);
router.get("/trips/:tripId/manifest", auth, requireRole("partner", "admin"), ctrl.tripManifest);

module.exports = router;

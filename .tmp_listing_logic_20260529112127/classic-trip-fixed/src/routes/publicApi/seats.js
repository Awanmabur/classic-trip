const router = require("express").Router();
const ctrl = require("../../controllers/public/seatController");
const { auth, requireRole } = require("../../middleware/auth");

router.get("/trip/:tripId", ctrl.getSeatMap);
router.post("/trip/:tripId/hold", auth, requireRole("customer", "promoter", "admin", "super_admin"), ctrl.holdSeats);
router.delete("/trip/:tripId/hold", auth, requireRole("customer", "promoter", "admin", "super_admin"), ctrl.releaseHolds);

module.exports = router;

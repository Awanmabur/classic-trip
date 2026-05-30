const router = require("express").Router();
const ctrl = require("../controllers/seat");
const { auth } = require("../middleware/auth");
const { requireRole } = require("../middleware/roles");

// public
router.get("/trip/:tripId", ctrl.getSeatMap);

// customer
router.post("/trip/:tripId/hold", auth, requireRole("customer", "admin"), ctrl.holdSeats);
router.delete("/trip/:tripId/hold", auth, requireRole("customer", "admin"), ctrl.releaseHolds);

module.exports = router;

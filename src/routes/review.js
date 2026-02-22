const router = require("express").Router();
const ctrl = require("../controllers/review");
const { auth } = require("../middleware/auth");
const { requireRole } = require("../middleware/roles");

router.get("/route/:routeId", ctrl.listForRoute);
router.post("/", auth, requireRole("customer", "admin"), ctrl.createOrUpdate);

module.exports = router;

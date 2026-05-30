const router = require("express").Router();
const ctrl = require("../../controllers/public/reviewController");
const { auth, requireRole } = require("../../middleware/auth");

router.get("/route/:routeId", ctrl.listForRoute);
router.post("/", auth, requireRole("customer", "admin", "super_admin"), ctrl.createOrUpdate);

module.exports = router;

const router = require("express").Router();
const { auth } = require("../middleware/auth");
const { requireRole } = require("../middleware/roles");
const c = require("../controllers/admin");

router.get("/stats", auth, requireRole("admin"), c.stats);
router.get("/users", auth, requireRole("admin"), c.users);
router.get("/bookings", auth, requireRole("admin"), c.bookings);

module.exports = router;

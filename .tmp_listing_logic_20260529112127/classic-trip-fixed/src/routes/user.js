const router = require("express").Router();
const ctrl = require("../controllers/user");
const { auth } = require("../middleware/auth");
const { requireRole } = require("../middleware/roles");

router.get("/me", auth, ctrl.me);

// admin
router.get("/", auth, requireRole("admin", "super_admin"), ctrl.list);
router.patch("/:id/role", auth, requireRole("admin", "super_admin"), ctrl.setRole);
router.patch("/:id/status", auth, requireRole("admin", "super_admin"), ctrl.setStatus);

module.exports = router;

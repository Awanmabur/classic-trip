const router = require("express").Router();
const ctrl = require("../../controllers/platform/userController");
const { auth, requireRole } = require("../../middleware/auth");
const validate = require("../../middleware/validation");
const { myProfileSchema } = require("../../validation");

router.get("/me", auth, ctrl.me);
router.patch("/me", auth, validate(myProfileSchema), ctrl.updateMe);
router.get("/", auth, requireRole("admin", "super_admin"), ctrl.list);
router.patch("/:id/role", auth, requireRole("admin", "super_admin"), ctrl.setRole);
router.patch("/:id/status", auth, requireRole("admin", "super_admin"), ctrl.setStatus);

module.exports = router;

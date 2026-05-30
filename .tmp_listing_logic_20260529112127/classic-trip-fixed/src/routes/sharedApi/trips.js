const router = require("express").Router();
const ctrl = require("../../controllers/tenant/tripController");
const { auth, requireRole } = require("../../middleware/auth");
const validate = require("../../middleware/validation");
const { tripCreateSchema, tripUpdateSchema } = require("../../validation");

router.get("/", ctrl.searchPublic);
router.get("/:id", ctrl.getOne);

router.post(
  "/",
  auth,
  requireRole("partner", "company_admin", "admin", "super_admin"),
  validate(tripCreateSchema),
  ctrl.create
);

router.patch(
  "/:id",
  auth,
  requireRole("partner", "company_admin", "admin", "super_admin"),
  validate(tripUpdateSchema),
  ctrl.update
);

module.exports = router;

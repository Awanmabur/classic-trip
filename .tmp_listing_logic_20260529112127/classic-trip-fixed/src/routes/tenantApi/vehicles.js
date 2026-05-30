const router = require("express").Router();
const ctrl = require("../../controllers/tenant/vehicleController");
const { auth, requireRole } = require("../../middleware/auth");
const { makeUpload } = require("../../uploads");
const { CLOUDINARY_FOLDER } = require("../../config/app");
const validate = require("../../middleware/validation");
const { vehicleCreateSchema, vehicleUpdateSchema } = require("../../validation");

const upload = makeUpload(`${CLOUDINARY_FOLDER}/vehicles`);

router.post(
  "/",
  auth,
  requireRole("partner", "company_admin", "admin", "super_admin"),
  upload.array("images", 8),
  validate(vehicleCreateSchema),
  ctrl.create
);
router.get("/", auth, requireRole("partner", "company_admin", "admin", "super_admin"), ctrl.listMine);
router.get("/:id", auth, requireRole("partner", "company_admin", "admin", "super_admin"), ctrl.getOne);
router.patch(
  "/:id",
  auth,
  requireRole("partner", "company_admin", "admin", "super_admin"),
  upload.array("images", 8),
  validate(vehicleUpdateSchema),
  ctrl.update
);
router.delete(
  "/:id",
  auth,
  requireRole("partner", "company_admin", "admin", "super_admin"),
  ctrl.remove
);

module.exports = router;

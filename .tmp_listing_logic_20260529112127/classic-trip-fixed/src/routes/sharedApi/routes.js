const router = require("express").Router();
const ctrl = require("../../controllers/tenant/routeController");
const { auth, requireRole } = require("../../middleware/auth");
const { makeUpload } = require("../../uploads");
const { CLOUDINARY_FOLDER } = require("../../config/app");
const validate = require("../../middleware/validation");
const { routeCreateSchema, routeUpdateSchema } = require("../../validation");

const upload = makeUpload(`${CLOUDINARY_FOLDER}/routes`);

router.get("/", ctrl.listPublic);
router.post(
  "/",
  auth,
  requireRole("partner", "company_admin", "admin", "super_admin"),
  upload.array("images", 10),
  validate(routeCreateSchema),
  ctrl.create
);
router.get("/mine/list", auth, requireRole("partner", "company_admin", "admin", "super_admin"), ctrl.listMine);
router.get("/:id", ctrl.getOne);
router.patch(
  "/:id",
  auth,
  requireRole("partner", "company_admin", "admin", "super_admin"),
  upload.array("images", 10),
  validate(routeUpdateSchema),
  ctrl.update
);
router.delete(
  "/:id",
  auth,
  requireRole("partner", "company_admin", "admin", "super_admin"),
  ctrl.remove
);

module.exports = router;

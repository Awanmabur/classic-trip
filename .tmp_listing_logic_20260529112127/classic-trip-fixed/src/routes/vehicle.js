const router = require("express").Router();
const ctrl = require("../controllers/vehicle");
const { auth } = require("../middleware/auth");
const { requireRole } = require("../middleware/roles");
const { makeUpload } = require("../uploads/uploader");
const { CLOUDINARY_FOLDER } = require("../config/env");

const upload = makeUpload(`${CLOUDINARY_FOLDER}/vehicles`);

router.post("/", auth, requireRole("partner", "company_admin", "admin", "super_admin"), upload.array("images", 8), ctrl.create);
router.get("/", auth, requireRole("partner", "company_admin", "admin", "super_admin"), ctrl.listMine);
router.get("/:id", auth, requireRole("partner", "company_admin", "admin", "super_admin"), ctrl.getOne);

module.exports = router;

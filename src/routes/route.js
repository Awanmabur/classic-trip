const router = require("express").Router();
const ctrl = require("../controllers/route");
const { auth } = require("../middleware/auth");
const { requireRole } = require("../middleware/roles");
const { makeUpload } = require("../uploads/uploader");
const { CLOUDINARY_FOLDER } = require("../config/env");

const upload = makeUpload(`${CLOUDINARY_FOLDER}/routes`);

// public list
router.get("/", ctrl.listPublic);
router.get("/:id", ctrl.getOne);

// partner/admin manage
router.post("/", auth, requireRole("partner", "admin"), upload.array("images", 10), ctrl.create);
router.get("/mine/list", auth, requireRole("partner", "admin"), ctrl.listMine);

module.exports = router;

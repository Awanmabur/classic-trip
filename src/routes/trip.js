const router = require("express").Router();
const ctrl = require("../controllers/trip");
const { auth } = require("../middleware/auth");
const { requireRole } = require("../middleware/roles");

// public search
router.get("/", ctrl.searchPublic);
router.get("/:id", ctrl.getOne);

// partner/admin create
router.post("/", auth, requireRole("partner", "admin"), ctrl.create);

module.exports = router;

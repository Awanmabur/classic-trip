const router = require("express").Router();
const controller = require("../controllers/shared/opsController");

router.get("/healthz", controller.health);
router.get("/readyz", controller.ready);

module.exports = router;

const router = require("express").Router();
const { auth } = require("../../middleware/auth");
const controller = require("../../controllers/tenant/promotionController");

router.get("/me", auth, controller.myReferral);
router.get("/resolve/:code", controller.resolve);

module.exports = router;

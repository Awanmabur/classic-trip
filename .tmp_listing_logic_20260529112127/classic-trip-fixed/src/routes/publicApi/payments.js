const router = require("express").Router();

const controller = require("../../controllers/public/paymentController");
const { optionalAuth } = require("../../middleware/auth");
const { limiterPayment } = require("../../config/http");

router.post("/checkout", limiterPayment(), optionalAuth, controller.checkout);
router.get("/:paymentId", optionalAuth, controller.getOne);
router.post("/:paymentId/mock-complete", limiterPayment(), optionalAuth, controller.mockComplete);

module.exports = router;

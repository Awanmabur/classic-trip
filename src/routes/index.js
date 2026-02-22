const router = require("express").Router();

// API routes
router.use("/auth", require("./auth"));
router.use("/users", require("./user"));
router.use("/vehicles", require("./vehicle"));
router.use("/routes", require("./route"));
router.use("/trips", require("./trip"));
router.use("/seats", require("./seat"));
router.use("/bookings", require("./booking"));
router.use("/partners", require("./partner"));
router.use("/reviews", require("./review"));
router.use("/wallet", require("./wallet"));
router.use("/promotions", require("./promotion"));
router.use("/admin", require("./admin"));

module.exports = router;

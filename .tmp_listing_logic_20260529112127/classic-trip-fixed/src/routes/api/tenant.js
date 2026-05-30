const router = require("express").Router();

router.use("/partners", require("../tenantApi/partners"));
router.use("/company", require("../tenantApi/company"));
router.use("/promotions", require("../tenantApi/promotions"));
router.use("/routes", require("../sharedApi/routes"));
router.use("/trips", require("../sharedApi/trips"));
router.use("/vehicles", require("../tenantApi/vehicles"));
router.use("/wallet", require("../sharedApi/wallet"));

module.exports = router;

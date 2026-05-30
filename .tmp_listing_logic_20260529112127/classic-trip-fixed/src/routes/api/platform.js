const router = require("express").Router();

router.use("/admin", require("../platformApi/admin"));
router.use("/dashboards", require("../platformApi/dashboards"));
router.use("/users", require("../platformApi/users"));

module.exports = router;

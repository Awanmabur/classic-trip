const router = require("express").Router();
const { auth } = require("../middleware/auth");
const c = require("../controllers/promotion");

router.get("/me", auth, c.myReferral);
router.get("/resolve/:code", c.resolve);

module.exports = router;

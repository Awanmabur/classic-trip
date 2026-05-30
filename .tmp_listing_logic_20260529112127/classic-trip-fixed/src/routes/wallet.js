const router = require("express").Router();
const { auth } = require("../middleware/auth");
const c = require("../controllers/wallet");

router.get("/me", auth, c.me);

module.exports = router;

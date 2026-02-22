const router = require("express").Router();
const ctrl = require("../controllers/auth");
const { limiterAuth } = require("../config/security");
const { auth } = require("../middleware/auth");

router.post("/register", limiterAuth(), ctrl.register);
router.post("/login", limiterAuth(), ctrl.login);
router.post("/refresh", limiterAuth(), ctrl.refresh);
router.post("/logout", ctrl.logout);

router.get("/sessions", auth, ctrl.mySessions);
router.delete("/sessions/:id", auth, ctrl.revokeSession);

module.exports = router;

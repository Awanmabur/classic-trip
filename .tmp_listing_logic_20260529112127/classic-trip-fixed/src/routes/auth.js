const router = require("express").Router();
const ctrl = require("../controllers/auth");
const { limiterAuth } = require("../config/security");
const { auth } = require("../middleware/auth");
const validate = require("../middleware/validate");
const { registerSchema, loginSchema } = require("../validation/schemas");

router.post("/register", limiterAuth(), validate(registerSchema), ctrl.register);
router.post("/login", limiterAuth(), validate(loginSchema), ctrl.login);
router.post("/refresh", limiterAuth(), ctrl.refresh);
router.post("/logout", ctrl.logout);

router.get("/sessions", auth, ctrl.mySessions);
router.delete("/sessions/:id", auth, ctrl.revokeSession);

module.exports = router;

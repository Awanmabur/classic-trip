const router = require("express").Router();

const controller = require("../../controllers/public/invitationController");
const validate = require("../../middleware/validation");
const { limiterAuth } = require("../../config/http");
const { inviteAcceptSchema } = require("../../validation");

router.get("/:token", controller.getOne);
router.post("/:token/accept", limiterAuth(), validate(inviteAcceptSchema), controller.accept);

module.exports = router;

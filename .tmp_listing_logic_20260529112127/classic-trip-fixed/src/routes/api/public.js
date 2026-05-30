const router = require("express").Router();
const { optionalAuth } = require("../../middleware/auth");
const validate = require("../../middleware/validation");
const {
  limiterAuth,
  limiterPublicForms
} = require("../../config/http");
const publicControllers = require("../../controllers/public");
const {
  partnerInquirySchema,
  recoveryRequestSchema,
  supportRequestSchema
} = require("../../validation");

router.get("/marketplace/bootstrap", publicControllers.marketplace.bootstrap);
router.post(
  "/support-requests",
  limiterPublicForms(),
  optionalAuth,
  validate(supportRequestSchema),
  publicControllers.requests.createSupportRequest
);
router.post(
  "/partner-inquiries",
  limiterPublicForms(),
  optionalAuth,
  validate(partnerInquirySchema),
  publicControllers.requests.createPartnerInquiry
);
router.post(
  "/recovery-requests",
  limiterAuth(),
  validate(recoveryRequestSchema),
  publicControllers.requests.createRecoveryRequest
);

router.use("/auth", require("../publicApi/auth"));
router.use("/invitations", require("../publicApi/invitations"));
router.use("/bookings", require("../publicApi/bookings"));
router.use("/payments", require("../publicApi/payments"));
router.use("/promotions", require("../tenantApi/promotions"));
router.use("/reviews", require("../publicApi/reviews"));
router.use("/seats", require("../publicApi/seats"));
router.use("/tickets", require("../publicApi/tickets"));
router.use("/trips", require("../sharedApi/trips"));
router.use("/wallet", require("../sharedApi/wallet"));

module.exports = router;

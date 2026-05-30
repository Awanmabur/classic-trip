const router = require("express").Router();
const { auth, requireRole } = require("../../middleware/auth");
const controller = require("../../controllers/platform/adminController");
const validate = require("../../middleware/validation");
const {
  partnerInviteCreateSchema,
  partnerInquiryReviewSchema,
  partnerStatusSchema
} = require("../../validation");

router.get("/stats", auth, requireRole("admin", "super_admin"), controller.stats);
router.get("/users", auth, requireRole("admin", "super_admin"), controller.users);
router.get("/bookings", auth, requireRole("admin", "super_admin"), controller.bookings);
router.get("/partner-inquiries", auth, requireRole("admin", "super_admin"), controller.partnerInquiries);
router.post(
  "/partner-inquiries/:id/review",
  auth,
  requireRole("admin", "super_admin"),
  validate(partnerInquiryReviewSchema),
  controller.reviewPartnerInquiry
);
router.get("/partner-invites", auth, requireRole("admin", "super_admin"), controller.partnerInvites);
router.post(
  "/partner-invites",
  auth,
  requireRole("admin", "super_admin"),
  validate(partnerInviteCreateSchema),
  controller.createPartnerInvite
);
router.post("/partner-invites/:id/resend", auth, requireRole("admin", "super_admin"), controller.resendPartnerInvite);
router.post("/partner-invites/:id/revoke", auth, requireRole("admin", "super_admin"), controller.revokePartnerInvite);
router.get("/partners", auth, requireRole("admin", "super_admin"), controller.partners);
router.patch(
  "/partners/:id/status",
  auth,
  requireRole("admin", "super_admin"),
  validate(partnerStatusSchema),
  controller.setPartnerStatus
);

// Payout requests (cross-tenant)
router.get("/payout-requests", auth, requireRole("admin", "super_admin"), controller.payoutRequests);
router.patch(
  "/payout-requests/:tenantSlug/:id",
  auth,
  requireRole("admin", "super_admin"),
  controller.reviewPayoutRequest
);

// Promoter / customer withdrawal requests (platform wallet txns)
const walletController = require("../../controllers/shared/walletController");
router.get("/withdrawals", auth, requireRole("admin", "super_admin"), walletController.listWithdrawals);

module.exports = router;

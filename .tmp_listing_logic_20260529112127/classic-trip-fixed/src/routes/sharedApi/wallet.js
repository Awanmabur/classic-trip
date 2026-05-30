const router = require("express").Router();
const { auth, requireRole } = require("../../middleware/auth");
const controller = require("../../controllers/shared/walletController");

// Any authenticated user can view their wallet
router.get("/me", auth, controller.me);

// Promoters, company admins, partners can request withdrawals
router.post(
  "/withdraw",
  auth,
  requireRole("promoter", "company_admin", "partner", "customer"),
  controller.requestWithdrawal
);

module.exports = router;

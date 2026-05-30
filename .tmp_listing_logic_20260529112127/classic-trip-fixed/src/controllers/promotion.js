const asyncHandler = require("../middleware/asyncHandler");
const User = require("../models/user");
const Wallet = require("../models/wallet");
const { getOrCreateWallet } = require("../services/wallet");

exports.myReferral = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.userId).select("referralCode name email role").lean();
  const wallet = await getOrCreateWallet(req.user.userId, "UGX");
  res.json({ ok: true, user, wallet });
});

exports.resolve = asyncHandler(async (req, res) => {
  const code = String(req.params.code || "").trim();
  if (!code) return res.status(400).json({ ok: false, message: "code required" });
  const promoter = await User.findOne({ referralCode: code }).select("name referralCode").lean();
  if (!promoter) return res.status(404).json({ ok: false, message: "Referral not found" });
  res.json({ ok: true, promoter });
});

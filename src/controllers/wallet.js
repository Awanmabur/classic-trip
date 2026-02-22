const asyncHandler = require("../middleware/asyncHandler");
const Wallet = require("../models/wallet");
const WalletTxn = require("../models/walletTxn");
const { getOrCreateWallet } = require("../services/wallet");

exports.me = asyncHandler(async (req, res) => {
  const wallet = await getOrCreateWallet(req.user.userId, "UGX");
  const txns = await WalletTxn.find({ userId: req.user.userId }).sort("-createdAt").limit(50).lean();
  res.json({ ok: true, wallet, txns });
});

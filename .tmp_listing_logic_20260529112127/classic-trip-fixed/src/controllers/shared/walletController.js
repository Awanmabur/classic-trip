const { asyncHandler } = require("../../middleware/http");
const { Wallet, WalletTxn } = require("../../models/shared");
const { getOrCreateWallet } = require("../../services/shared/wallet");
const { debit } = require("../../services/shared/wallet");

const MIN_WITHDRAWAL = 5000;

function serializeWallet(wallet) {
  return {
    id: wallet._id,
    balance: Number(wallet.balance || 0),
    pendingBalance: Number(wallet.pendingBalance || 0),
    totalEarned: Number(wallet.totalEarned || 0),
    totalWithdrawn: Number(wallet.totalWithdrawn || 0),
    currency: wallet.currency || "UGX",
    status: wallet.status || "active"
  };
}

function serializeTxn(txn) {
  return {
    id: txn._id,
    type: txn.type,
    amount: txn.amount,
    currency: txn.currency || "UGX",
    note: txn.note || "",
    bookingId: txn.bookingId || null,
    createdAt: txn.createdAt
  };
}

/** GET /api/public/wallet/me */
exports.me = asyncHandler(async (req, res) => {
  const wallet = await getOrCreateWallet(req.user.userId, "UGX");
  const txns = await WalletTxn.find({ userId: req.user.userId })
    .sort("-createdAt")
    .limit(50)
    .lean();
  res.json({
    ok: true,
    wallet: serializeWallet(wallet),
    txns: txns.map(serializeTxn)
  });
});

/** POST /api/public/wallet/withdraw */
exports.requestWithdrawal = asyncHandler(async (req, res) => {
  const amount = Number(req.body?.amount || 0);
  const destination = String(req.body?.destination || "").trim();
  const note = String(req.body?.note || "").trim();

  if (!amount || amount < MIN_WITHDRAWAL) {
    return res.status(400).json({ ok: false, message: `Minimum withdrawal is ${MIN_WITHDRAWAL} UGX` });
  }
  if (!destination) {
    return res.status(400).json({ ok: false, message: "destination is required (phone / account number)" });
  }

  const wallet = await getOrCreateWallet(req.user.userId, "UGX");
  if (Number(wallet.balance || 0) < amount) {
    return res.status(400).json({
      ok: false,
      message: `Insufficient balance. Available: ${wallet.currency} ${wallet.balance}`
    });
  }

  const { txn } = await debit(
    req.user.userId,
    amount,
    wallet.currency,
    { type: "withdrawal_request", note: `Withdrawal to ${destination}${note ? ": " + note : ""}` }
  );

  const updated = await getOrCreateWallet(req.user.userId, "UGX");
  updated.totalWithdrawn = Number(updated.totalWithdrawn || 0) + amount;
  await updated.save();

  res.status(201).json({
    ok: true,
    message: "Withdrawal request submitted. It will be reviewed and paid shortly.",
    withdrawal: { txnId: txn?._id, amount, currency: wallet.currency, destination, status: "pending", createdAt: new Date() },
    wallet: serializeWallet(updated)
  });
});

/** GET /api/platform/admin/withdrawals — admin only */
exports.listWithdrawals = asyncHandler(async (req, res) => {
  const limit = Math.min(200, Number(req.query.limit || 80));

  const txns = await WalletTxn.find({ type: "withdrawal_request" })
    .populate("userId", "name email phone role referralCode companyName")
    .sort("-createdAt")
    .limit(limit)
    .lean();

  const items = txns.map((txn) => ({
    id: txn._id,
    user: txn.userId
      ? {
          id: txn.userId._id,
          name: txn.userId.name,
          email: txn.userId.email,
          phone: txn.userId.phone || "",
          role: txn.userId.role,
          referralCode: txn.userId.referralCode || "",
          companyName: txn.userId.companyName || ""
        }
      : null,
    amount: txn.amount,
    currency: txn.currency || "UGX",
    note: txn.note || "",
    createdAt: txn.createdAt
  }));

  res.json({ ok: true, items });
});

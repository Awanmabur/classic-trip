const Wallet = require("../models/wallet");
const WalletTxn = require("../models/walletTxn");

function normalizeOwnerId(userId) {
  return typeof userId === "string" ? userId.trim() : userId;
}

async function getOrCreateWallet(userId, currency = "UGX") {
  const ownerId = normalizeOwnerId(userId);

  let wallet = await Wallet.findOne({
    $or: [{ userId: ownerId }, { ownerId }]
  });

  if (!wallet) {
    wallet = await Wallet.create({
      userId: ownerId,
      ownerType: "user",
      ownerId,
      currency,
      balance: 0,
      pendingBalance: 0,
      totalEarned: 0,
      totalWithdrawn: 0,
      status: "active"
    });
  } else {
    let changed = false;

    if (!wallet.userId) {
      wallet.userId = wallet.ownerId || ownerId;
      changed = true;
    }
    if (!wallet.ownerId) {
      wallet.ownerId = wallet.userId || ownerId;
      changed = true;
    }
    if (!wallet.ownerType) {
      wallet.ownerType = "user";
      changed = true;
    }
    if (currency && !wallet.currency) {
      wallet.currency = currency;
      changed = true;
    }

    if (changed) await wallet.save();
  }

  return wallet;
}

async function credit(userId, amount, currency, payload = {}) {
  if (!amount || amount <= 0) return { wallet: await getOrCreateWallet(userId, currency), txn: null };
  const wallet = await getOrCreateWallet(userId, currency);
  wallet.balance = Number(wallet.balance || 0) + Number(amount);
  wallet.totalEarned = Number(wallet.totalEarned || 0) + Number(amount);
  if (currency) wallet.currency = currency;
  await wallet.save();
  const txn = await WalletTxn.create({
    userId,
    type: payload.type || "referral_credit",
    amount,
    currency: wallet.currency,
    ...payload
  });
  return { wallet, txn };
}

async function redeem(userId, amount, currency, payload = {}) {
  if (!amount || amount <= 0) return { wallet: await getOrCreateWallet(userId, currency), txn: null, used: 0 };
  const wallet = await getOrCreateWallet(userId, currency);
  if (currency && wallet.currency !== currency) {
    const err = new Error("Wallet currency mismatch");
    err.statusCode = 400;
    throw err;
  }
  const usable = Math.max(0, Math.min(Number(wallet.balance || 0), Number(amount)));
  wallet.balance = Number(wallet.balance || 0) - usable;
  await wallet.save();
  const txn = usable
    ? await WalletTxn.create({
        userId,
        type: payload.type || "redeem_debit",
        amount: usable,
        currency: wallet.currency,
        ...payload
      })
    : null;

  return { wallet, txn, used: usable };
}

module.exports = { getOrCreateWallet, credit, redeem };

const Wallet = require("../models/wallet");
const WalletTxn = require("../models/walletTxn");

async function getOrCreateWallet(userId, currency = "UGX") {
  let w = await Wallet.findOne({ userId });
  if (!w) w = await Wallet.create({ userId, currency, balance: 0 });
  return w;
}

async function credit(userId, amount, currency, payload = {}) {
  if (!amount || amount <= 0) return { wallet: await getOrCreateWallet(userId, currency), txn: null };
  const wallet = await getOrCreateWallet(userId, currency);
  wallet.balance = Number(wallet.balance || 0) + Number(amount);
  if (currency) wallet.currency = currency;
  await wallet.save();
  const txn = await WalletTxn.create({
    userId,
    type: "referral_credit",
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
    // In real production you'd convert; for now reject
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
        type: "redeem_debit",
        amount: usable,
        currency: wallet.currency,
        ...payload
      })
    : null;

  return { wallet, txn, used: usable };
}

module.exports = { getOrCreateWallet, credit, redeem };

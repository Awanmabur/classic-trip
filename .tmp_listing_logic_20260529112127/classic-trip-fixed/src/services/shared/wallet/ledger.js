const { WalletTxn } = require("../../../models/shared");
const { createOptions } = require("../database");
const { getOrCreateWallet } = require("./core");

async function credit(ownerId, amount, currency, payload = {}, session = null) {
  if (!amount || amount <= 0) return { wallet: await getOrCreateWallet(ownerId, currency, session), txn: null };
  const wallet = await getOrCreateWallet(ownerId, currency, session);
  wallet.balance = Number(wallet.balance || 0) + Number(amount);
  wallet.totalEarned = Number(wallet.totalEarned || 0) + Number(amount);
  if (currency) wallet.currency = currency;
  await wallet.save(createOptions(session));

  const [txn] = await WalletTxn.create([{
    userId: ownerId,
    type: payload.type || "referral_credit",
    amount,
    currency: wallet.currency,
    ...payload
  }], createOptions(session));

  return { wallet, txn };
}

async function debit(ownerId, amount, currency, payload = {}, session = null) {
  if (!amount || amount <= 0) return { wallet: await getOrCreateWallet(ownerId, currency, session), txn: null, used: 0 };
  const wallet = await getOrCreateWallet(ownerId, currency, session);
  if (currency && wallet.currency !== currency) {
    const err = new Error("Wallet currency mismatch");
    err.statusCode = 400;
    throw err;
  }

  const usable = Math.max(0, Math.min(Number(wallet.balance || 0), Number(amount)));
  wallet.balance = Number(wallet.balance || 0) - usable;
  await wallet.save(createOptions(session));

  const txn = usable
    ? (await WalletTxn.create([{
        userId: ownerId,
        type: payload.type || "manual_debit",
        amount: usable,
        currency: wallet.currency,
        ...payload
      }], createOptions(session)))[0]
    : null;

  return { wallet, txn, used: usable };
}

async function redeem(userId, amount, currency, payload = {}, session = null) {
  return debit(
    userId,
    amount,
    currency,
    { type: payload.type || "redeem_debit", ...payload },
    session
  );
}

module.exports = {
  credit,
  debit,
  redeem
};

const { Wallet } = require("../../../models/shared");
const { createOptions, withSession } = require("../database");
const { resolveOwnerType } = require("./ownership");

async function getOrCreateWallet(ownerId, currency = "UGX", session = null, ownerType = "") {
  const resolvedOwnerType = ownerType || await resolveOwnerType(ownerId, session);
  let wallet = await withSession(Wallet.findOne({ ownerType: resolvedOwnerType, ownerId }), session);

  if (!wallet) {
    [wallet] = await Wallet.create([{
      userId: ownerId,
      ownerType: resolvedOwnerType,
      ownerId,
      balance: 0,
      pendingBalance: 0,
      totalEarned: 0,
      totalWithdrawn: 0,
      currency,
      status: "active"
    }], createOptions(session));
  }

  return wallet;
}

module.exports = {
  getOrCreateWallet
};

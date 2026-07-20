const { Schema, model } = require('./_helpers');

const walletSchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  ownerType: { type: String, required: true, index: true },
  ownerId: { type: String, required: true, index: true },
  currency: { type: String, required: true },
  availableBalance: { type: Number, default: 0 },
  pendingBalance: { type: Number, default: 0 },
}, { timestamps: true });

// One wallet row per (owner, currency) - not per owner. An owner touching a second currency
// (the platform's own wallet holding fees from companies in different currencies, for example)
// gets a second, fully separate wallet row rather than having that currency's amounts silently
// added onto the first currency's balance as if they were the same unit.
walletSchema.index({ ownerType: 1, ownerId: 1, currency: 1 }, { unique: true });
module.exports = model('Wallet', walletSchema);

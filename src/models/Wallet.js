const { Schema, model } = require('./_helpers');

const walletSchema = new Schema({
  id: { type: String, index: true },
  ownerType: { type: String, required: true, index: true },
  ownerId: { type: String, required: true, index: true },
  currency: { type: String, default: 'UGX' },
  availableBalance: { type: Number, default: 0 },
  pendingBalance: { type: Number, default: 0 },
}, { timestamps: true });

walletSchema.index({ ownerType: 1, ownerId: 1 }, { unique: true });
module.exports = model('Wallet', walletSchema);

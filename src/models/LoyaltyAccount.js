const { Schema, model } = require('./_helpers');

const loyaltyAccountSchema = new Schema({
  id: { type: String, index: true }, userId: { type: String, index: true }, tier: String, pointsBalance: Number, walletCreditBalance: Number,
  coupons: [{ code: String, value: Number, expiresAt: Date, status: String }], referralRewards: [{ referralCode: String, points: Number, status: String }],
  status: { type: String, default: 'planned' },
}, { timestamps: true });
module.exports = model('LoyaltyAccount', loyaltyAccountSchema);

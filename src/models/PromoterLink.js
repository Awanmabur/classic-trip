const { Schema, model } = require('./_helpers');

const promoterLinkSchema = new Schema({
  id: { type: String, index: true },
  promoterId: { type: String, required: true, index: true },
  listingId: { type: String, required: true, index: true },
  code: { type: String, required: true, unique: true, index: true },
  referralCode: { type: String, index: true },
  url: String,
  clicks: { type: Number, default: 0 },
  conversions: { type: Number, default: 0 },
  status: { type: String, default: 'active', index: true, enum: ['active', 'archived'] },
}, { timestamps: true });

promoterLinkSchema.index({ listingId: 1, status: 1, createdAt: -1 });
module.exports = model('PromoterLink', promoterLinkSchema);

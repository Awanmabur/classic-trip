const { Schema, model } = require('./_helpers');

const referralClickSchema = new Schema({
  id: { type: String, index: true },
  linkId: { type: String, index: true },
  promoterId: { type: String, index: true },
  listingId: { type: String, index: true },
  code: String,
  ip: String,
  userAgent: String,
}, { timestamps: true });

module.exports = model('ReferralClick', referralClickSchema);

const { Schema, model } = require('./_helpers');

const campaignConversionSchema = new Schema({
  id: { type: String, index: true },
  campaignId: { type: String, index: true },
  linkId: { type: String, index: true },
  clickId: { type: String, index: true },
  promoterId: { type: String, index: true },
  listingId: { type: String, index: true },
  companyId: { type: String, index: true },
  bookingId: String,
  bookingRef: { type: String, index: true },
  customerUserId: String,
  amount: Number,
  commissionAmount: Number,
  currency: { type: String, default: 'UGX' },
  attributionSource: String,
  status: { type: String, default: 'pending', index: true },
  convertedAt: Date,
}, { timestamps: true });

module.exports = model('CampaignConversion', campaignConversionSchema);

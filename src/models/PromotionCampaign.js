const { Schema, model } = require('./_helpers');

const promotionCampaignSchema = new Schema({
  id: { type: String, index: true },
  companyId: { type: String, required: true, index: true },
  promoterId: { type: String, index: true },
  listingId: { type: String, index: true },
  name: String,
  placement: { type: String, index: true },
  budget: Number,
  clicks: { type: Number, default: 0 },
  bookings: { type: Number, default: 0 },
  status: { type: String, default: 'draft', index: true },
  startsAt: Date,
  endsAt: Date,
}, { timestamps: true });

module.exports = model('PromotionCampaign', promotionCampaignSchema);

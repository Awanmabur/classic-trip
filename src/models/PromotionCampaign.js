const { Schema, model } = require('./_helpers');

const promotionCampaignSchema = new Schema({
  id: { type: String, index: true },
  companyId: { type: String, required: true, index: true },
  promoterId: { type: String, index: true },
  listingId: { type: String, index: true },
  name: String,
  placement: { type: String, index: true, enum: ['marketplace_top', 'route_card', 'hotel_card', 'banner', 'promoter_share', 'route_boost', 'homepage_feature'] },
  budget: Number,
  clicks: { type: Number, default: 0 },
  bookings: { type: Number, default: 0 },
  status: { type: String, default: 'draft', index: true, enum: ['draft', 'active', 'expired'] },
  startsAt: Date,
  endsAt: Date,
}, { timestamps: true });

module.exports = model('PromotionCampaign', promotionCampaignSchema);

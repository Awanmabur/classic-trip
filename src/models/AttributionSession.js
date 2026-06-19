const { Schema, model } = require('./_helpers');

const attributionSessionSchema = new Schema({
  id: { type: String, index: true },
  sessionKey: { type: String, index: true },
  clickId: { type: String, index: true },
  linkId: { type: String, index: true },
  promoterId: { type: String, index: true },
  listingId: { type: String, index: true },
  campaignId: { type: String, index: true },
  referralCode: String,
  source: String,
  medium: String,
  landingPath: String,
  ip: String,
  userAgent: String,
  status: { type: String, default: 'active', index: true },
  expiresAt: Date,
  convertedAt: Date,
  bookingRef: String,
}, { timestamps: true });

module.exports = model('AttributionSession', attributionSessionSchema);

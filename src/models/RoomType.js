const { Schema, mediaSchema, model } = require('./_helpers');

const roomTypeSchema = new Schema({
  id: { type: String, index: true },
  companyId: { type: String, required: true, index: true },
  listingId: { type: String, required: true, index: true },
  propertyId: { type: String, index: true },
  name: { type: String, required: true },
  capacity: Number,
  basePrice: Number,
  amenities: [String],
  images: [mediaSchema],
  policies: [String],
  taxesAndFees: [Schema.Types.Mixed],
  status: { type: String, default: 'active', index: true },
}, { timestamps: true });

module.exports = model('RoomType', roomTypeSchema);

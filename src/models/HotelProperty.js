const { Schema, mediaSchema, model } = require('./_helpers');

const hotelPropertySchema = new Schema({
  id: { type: String, index: true },
  companyId: { type: String, required: true, index: true },
  listingId: { type: String, required: true, index: true },
  propertyName: { type: String, required: true },
  address: String,
  city: String,
  country: String,
  mapLocation: String,
  checkInTime: String,
  checkOutTime: String,
  amenities: [String],
  policies: [String],
  taxesAndFees: [Schema.Types.Mixed],
  media: [mediaSchema],
  status: { type: String, default: 'active', index: true },
}, { timestamps: true });

module.exports = model('HotelProperty', hotelPropertySchema);

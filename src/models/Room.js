const { Schema, mediaSchema, model } = require('./_helpers');

const roomSchema = new Schema({
  id: { type: String, index: true },
  listingId: { type: String, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  roomType: String,
  capacity: Number,
  nightlyPrice: Number,
  inventory: Number,
  amenities: [String],
  media: [mediaSchema],
  status: { type: String, default: 'active', index: true },
}, { timestamps: true });

module.exports = model('Room', roomSchema);

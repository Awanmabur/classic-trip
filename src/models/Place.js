const { Schema, model } = require('./_helpers');
const placeSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true, text: true },
  shortName: String,
  type: { type: String, enum: ['address', 'landmark', 'office', 'airport', 'city', 'district', 'town', 'border', 'terminal'], default: 'address', index: true },
  country: { type: String, required: true, trim: true, index: true },
  countryCode: { type: String, uppercase: true, trim: true, index: true },
  city: { type: String, trim: true, index: true },
  district: { type: String, trim: true, index: true },
  address: String,
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  searchableTerms: [String],
  priority: { type: Number, default: 0 },
  status: { type: String, enum: ['active', 'paused', 'archived'], default: 'active', index: true },
}, { timestamps: true });
placeSchema.index({ countryCode: 1, city: 1, name: 1 });
module.exports = model('Place', placeSchema);

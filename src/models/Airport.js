const { Schema, model } = require('./_helpers');
const airportSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  iataCode: { type: String, required: true, uppercase: true, trim: true, unique: true, index: true },
  icaoCode: { type: String, uppercase: true, trim: true, sparse: true, unique: true, index: true },
  name: { type: String, required: true, trim: true, text: true },
  city: { type: String, required: true, trim: true, index: true },
  country: { type: String, required: true, trim: true, index: true },
  countryCode: { type: String, required: true, uppercase: true, trim: true, index: true },
  timezone: { type: String, required: true, trim: true },
  latitude: Number,
  longitude: Number,
  terminals: [String],
  status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
}, { timestamps: true });
airportSchema.index({ name: 'text', city: 'text', iataCode: 'text', country: 'text' });
module.exports = model('Airport', airportSchema);

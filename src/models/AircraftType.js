const { Schema, model } = require('./_helpers');
const aircraftTypeSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  manufacturer: { type: String, required: true, trim: true },
  model: { type: String, required: true, trim: true },
  iataCode: { type: String, uppercase: true, trim: true, index: true },
  icaoCode: { type: String, uppercase: true, trim: true, index: true },
  defaultSeatCapacity: { type: Number, min: 1 },
  status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
}, { timestamps: true });
aircraftTypeSchema.index({ manufacturer: 1, model: 1 }, { unique: true });
module.exports = model('AircraftType', aircraftTypeSchema);

const { Schema, model } = require('./_helpers');
const seatSchema = new Schema({
  seatNumber: { type: String, required: true },
  row: { type: Number, required: true, min: 1 },
  column: { type: String, required: true },
  cabinClass: { type: String, required: true, enum: ['economy', 'premium_economy', 'business', 'first'] },
  seatType: { type: String, enum: ['window', 'middle', 'aisle', 'crew', 'blocked'], default: 'middle' },
  exitRow: { type: Boolean, default: false },
  extraLegroom: { type: Boolean, default: false },
  bassinet: { type: Boolean, default: false },
  accessible: { type: Boolean, default: false },
  chargeAmount: { type: Number, min: 0, default: 0 },
}, { _id: false });
const flightSeatMapVersionSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  companyId: { type: String, required: true, index: true },
  aircraftTypeId: { type: String, index: true },
  name: { type: String, required: true, trim: true },
  version: { type: Number, required: true, min: 1 },
  layoutCode: { type: String, trim: true },
  deckCount: { type: Number, min: 1, default: 1 },
  seats: [seatSchema],
  status: { type: String, enum: ['draft', 'published', 'retired'], default: 'draft', index: true },
  publishedAt: Date,
  publishedBy: String,
}, { timestamps: true });
flightSeatMapVersionSchema.index({ companyId: 1, name: 1, version: 1 }, { unique: true });
module.exports = model('FlightSeatMapVersion', flightSeatMapVersionSchema);

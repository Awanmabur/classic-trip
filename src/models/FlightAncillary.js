const { Schema, model } = require('./_helpers');
const flightAncillarySchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  companyId: { type: String, required: true, index: true },
  airlineId: { type: String, index: true },
  code: { type: String, required: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  category: { type: String, enum: ['baggage', 'meal', 'seat', 'priority', 'lounge', 'assistance', 'insurance', 'other'], required: true, index: true },
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, required: true, uppercase: true, trim: true },
  metadata: Schema.Types.Mixed,
  status: { type: String, enum: ['active', 'paused', 'archived'], default: 'active', index: true },
}, { timestamps: true });
flightAncillarySchema.index({ companyId: 1, code: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['active', 'paused'] } } });
module.exports = model('FlightAncillary', flightAncillarySchema);

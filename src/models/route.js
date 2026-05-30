const { Schema, model } = require('./_helpers');

const routeSchema = new Schema({
  id: { type: String, index: true },
  listingId: { type: String, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  origin: { type: String, required: true, index: true },
  destination: { type: String, required: true, index: true },
  corridor: { type: String, index: true },
  boardingPoints: [String],
  dropoffPoints: [String],
  baggageRules: String,
  cancellationRules: String,
  status: { type: String, default: 'active', index: true },
}, { timestamps: true });

module.exports = model('Route', routeSchema);

const { Schema, model } = require('./_helpers');

const routeSchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  listingId: { type: String, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  routeName: String,
  origin: { type: String, required: true, index: true },
  destination: { type: String, required: true, index: true },
  originTerminalId: String,
  destinationTerminalId: String,
  distanceKm: Number,
  estimatedDuration: String,
  estimatedDurationMinutes: Number,
  operatingDays: [String],
  corridor: { type: String, index: true },
  boardingPoints: [String],
  dropoffPoints: [String],
  baggageRules: String,
  cancellationRules: String,
  publicInstructions: String,
  policies: [String],
  stops: [Schema.Types.Mixed],
  status: { type: String, default: 'active', index: true },
}, { timestamps: true });

module.exports = model('Route', routeSchema);

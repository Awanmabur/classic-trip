const { Schema, model } = require('./_helpers');

const routeSchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  listingId: { type: String, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  routeName: String,
  routeCode: { type: String, index: true },
  timezone: { type: String, default: 'Africa/Kampala' },
  version: { type: Number, default: 1, min: 1 },
  origin: { type: String, required: true, index: true },
  destination: { type: String, required: true, index: true },
  originTerminalId: { type: String, index: true },
  destinationTerminalId: { type: String, index: true },
  originStopId: { type: String, index: true },
  destinationStopId: { type: String, index: true },
  stopCount: { type: Number, default: 0, min: 0 },
  segmentCount: { type: Number, default: 0, min: 0 },
  activeFareProductId: { type: String, index: true },
  distanceKm: Number,
  estimatedDuration: String,
  estimatedDurationMinutes: Number,
  operatingDays: [String],
  corridor: { type: String, index: true },
  boardingBranchIds: [{ type: String, index: true }],
  dropoffBranchIds: [{ type: String, index: true }],
  boardingPoints: [String], // immutable public display snapshots
  dropoffPoints: [String], // immutable public display snapshots
  baggageRules: String,
  cancellationRules: String,
  publicInstructions: String,
  policies: [String],
  status: { type: String, default: 'active', index: true, enum: ['active', 'archived'] },
}, { timestamps: true });

module.exports = model('Route', routeSchema);

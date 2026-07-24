const { Schema, model } = require('./_helpers');

const routeSegmentSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  listingId: { type: String, required: true, index: true },
  routeId: { type: String, required: true, index: true },
  fromStopId: { type: String, required: true, index: true },
  toStopId: { type: String, required: true, index: true },
  fromOrder: { type: Number, required: true, min: 0 },
  toOrder: { type: Number, required: true, min: 1 },
  segmentOrder: { type: Number, required: true, min: 0 },
  distanceKm: { type: Number, min: 0 },
  durationMinutes: { type: Number, min: 0 },
  status: { type: String, enum: ['active', 'archived'], default: 'active', index: true },
}, { timestamps: true });

routeSegmentSchema.index({ routeId: 1, segmentOrder: 1 }, { unique: true });
routeSegmentSchema.index({ routeId: 1, fromStopId: 1, toStopId: 1 }, { unique: true });
module.exports = model('RouteSegment', routeSegmentSchema);

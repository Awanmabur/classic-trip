const { Schema, model } = require('./_helpers');

const busSegmentFareSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  listingId: { type: String, required: true, index: true },
  routeId: { type: String, required: true, index: true },
  fareProductId: { type: String, required: true, index: true },
  fromStopId: { type: String, required: true, index: true },
  toStopId: { type: String, required: true, index: true },
  fromOrder: { type: Number, required: true, min: 0 },
  toOrder: { type: Number, required: true, min: 1 },
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, required: true, uppercase: true, trim: true },
  status: { type: String, enum: ['active', 'paused', 'archived'], default: 'active', index: true },
}, { timestamps: true });

busSegmentFareSchema.index({ fareProductId: 1, fromStopId: 1, toStopId: 1 }, { unique: true });
busSegmentFareSchema.index({ routeId: 1, fromOrder: 1, toOrder: 1, status: 1 });
module.exports = model('BusSegmentFare', busSegmentFareSchema);

const { Schema, model } = require('./_helpers');

const routeStopSchema = new Schema({
  id: { type: String, index: true },
  routeId: { type: String, required: true, index: true },
  listingId: { type: String, index: true },
  companyId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  stopType: { type: String, default: 'intermediate' },
  stopOrder: { type: Number, default: 0 },
  timeOffsetMinutes: { type: Number, default: 0 },
  pickupAllowed: { type: Boolean, default: true },
  dropoffAllowed: { type: Boolean, default: true },
  publicInstructions: String,
  status: { type: String, default: 'active', index: true },
}, { timestamps: true });

routeStopSchema.index({ routeId: 1, stopOrder: 1 });
module.exports = model('RouteStop', routeStopSchema);

const { Schema, model } = require('./_helpers');
const rideQuoteSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  publicTokenHash: { type: String, unique: true, sparse: true, index: true },
  companyId: { type: String, required: true, index: true },
  platformManaged: { type: Boolean, default: true, index: true },
  listingId: { type: String, required: true, index: true },
  vehicleClassId: { type: String, required: true, index: true },
  fareRuleId: { type: String, required: true, index: true },
  serviceType: { type: String, enum: ['instant', 'scheduled', 'airport', 'intercity', 'hourly', 'corporate'], required: true, index: true },
  pickup: { type: Schema.Types.Mixed, required: true },
  destination: { type: Schema.Types.Mixed, required: true },
  stops: [Schema.Types.Mixed],
  scheduledPickupAt: Date,
  distanceKm: { type: Number, required: true, min: 0 },
  durationMinutes: { type: Number, required: true, min: 0 },
  routeSnapshot: Schema.Types.Mixed,
  priceSnapshot: { type: Schema.Types.Mixed, required: true },
  surgeMultiplier: { type: Number, min: 1, default: 1 },
  status: { type: String, enum: ['quoted', 'accepted', 'expired', 'cancelled'], default: 'quoted', index: true },
  expiresAt: { type: Date, required: true, index: true },
}, { timestamps: true });
rideQuoteSchema.index({ companyId: 1, expiresAt: 1, status: 1 });
module.exports = model('RideQuote', rideQuoteSchema);

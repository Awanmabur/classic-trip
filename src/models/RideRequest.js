const { Schema, model } = require('./_helpers');
const rideRequestSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  requestRef: { type: String, required: true, unique: true, index: true },
  companyId: { type: String, required: true, index: true },
  providerCompanyId: { type: String, index: true },
  platformManaged: { type: Boolean, default: true, index: true },
  listingId: { type: String, required: true, index: true },
  quoteId: { type: String, required: true, index: true },
  customerUserId: { type: String, index: true },
  contactSnapshot: Schema.Types.Mixed,
  serviceType: { type: String, required: true, index: true },
  requestedPickupAt: { type: Date, required: true, index: true },
  scheduled: { type: Boolean, default: false, index: true },
  pickup: { type: Schema.Types.Mixed, required: true },
  destination: { type: Schema.Types.Mixed, required: true },
  stops: [Schema.Types.Mixed],
  vehicleClassId: { type: String, required: true, index: true },
  passengerCount: { type: Number, min: 1, default: 1 },
  luggageCount: { type: Number, min: 0, default: 0 },
  accessibilityNeeds: [String],
  status: { type: String, enum: ['awaiting_payment', 'scheduled', 'dispatch_pending', 'offering', 'assigned', 'cancelled', 'expired', 'failed'], default: 'awaiting_payment', index: true },
  dispatchAfter: { type: Date, required: true, index: true },
  dispatchAttempts: { type: Number, min: 0, default: 0 },
  lastDispatchAt: Date,
}, { timestamps: true });
rideRequestSchema.index({ companyId: 1, status: 1, dispatchAfter: 1 });
module.exports = model('RideRequest', rideRequestSchema);

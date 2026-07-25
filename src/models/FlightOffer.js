const { Schema, model } = require('./_helpers');
const segmentSchema = new Schema({
  departureId: String,
  flightNumber: String,
  airlineId: String,
  originAirportId: String,
  destinationAirportId: String,
  departAt: Date,
  arriveAt: Date,
  aircraftId: String,
  cabinClass: String,
  fareFamilyId: String,
}, { _id: false });
const flightOfferSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  publicTokenHash: { type: String, unique: true, sparse: true, index: true },
  companyId: { type: String, required: true, index: true },
  supplierId: { type: String, index: true },
  supplierOfferRef: { type: String, index: true },
  listingId: { type: String, required: true, index: true },
  tripType: { type: String, enum: ['one_way', 'round_trip', 'multi_city'], default: 'one_way' },
  segments: [segmentSchema],
  passengerCounts: Schema.Types.Mixed,
  fareFamilyId: { type: String, required: true, index: true },
  priceSnapshot: { type: Schema.Types.Mixed, required: true },
  baggageSnapshot: Schema.Types.Mixed,
  policySnapshot: Schema.Types.Mixed,
  sourceMode: { type: String, enum: ['native_inventory', 'external_certified', 'referral_only'], required: true },
  status: { type: String, enum: ['created', 'verified', 'expired', 'used', 'invalid'], default: 'created', index: true },
  expiresAt: { type: Date, required: true, index: true },
  verifiedAt: Date,
}, { timestamps: true });
flightOfferSchema.index({ companyId: 1, expiresAt: 1, status: 1 });
module.exports = model('FlightOffer', flightOfferSchema);

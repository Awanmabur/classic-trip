const { Schema, moneySchema, model } = require('./_helpers');
const flightFareFamilySchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  companyId: { type: String, required: true, index: true },
  airlineId: { type: String, required: true, index: true },
  routeId: { type: String, index: true },
  code: { type: String, required: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  cabinClass: { type: String, required: true, enum: ['economy', 'premium_economy', 'business', 'first'], index: true },
  basePrice: { type: Number, required: true, min: 0 },
  currency: { type: String, required: true, uppercase: true, trim: true },
  checkedBaggageKg: { type: Number, min: 0, default: 0 },
  cabinBaggageKg: { type: Number, min: 0, default: 7 },
  mealIncluded: { type: Boolean, default: false },
  seatSelectionIncluded: { type: Boolean, default: false },
  changeable: { type: Boolean, default: false },
  refundable: { type: Boolean, default: false },
  changeFee: Number,
  cancellationFee: Number,
  noShowFee: Number,
  policySnapshot: Schema.Types.Mixed,
  status: { type: String, enum: ['draft', 'active', 'paused', 'archived'], default: 'draft', index: true },
}, { timestamps: true });
flightFareFamilySchema.index({ companyId: 1, airlineId: 1, code: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['draft', 'active', 'paused'] } } });
module.exports = model('FlightFareFamily', flightFareFamilySchema);

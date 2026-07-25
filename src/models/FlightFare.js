'use strict';

const { Schema, model } = require('./_helpers');

const flightFareSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  companyId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  cabinClass: { type: String, enum: ['economy', 'premium_economy', 'business', 'first'], required: true, index: true },
  currency: { type: String, required: true, trim: true, uppercase: true },
  baseFare: { type: Number, required: true, min: 0 },
  taxes: { type: Number, default: 0, min: 0 },
  serviceFee: { type: Number, default: 0, min: 0 },
  checkedBaggageKg: { type: Number, default: 0, min: 0 },
  cabinBaggageKg: { type: Number, default: 7, min: 0 },
  refundable: { type: Boolean, default: false },
  changeable: { type: Boolean, default: false },
  changeFee: { type: Number, default: 0, min: 0 },
  cancellationFee: { type: Number, default: 0, min: 0 },
  mealIncluded: { type: Boolean, default: false },
  seatSelectionIncluded: { type: Boolean, default: false },
  policyText: String,
  status: { type: String, enum: ['active', 'inactive', 'archived'], default: 'active', index: true },
}, { timestamps: true });

flightFareSchema.index({ companyId: 1, code: 1 }, { unique: true });
module.exports = model('FlightFare', flightFareSchema);

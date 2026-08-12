const { Schema, model } = require('./_helpers');
const taxiFareRuleSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  companyId: { type: String, required: true, index: true },
  vehicleClassId: { type: String, required: true, index: true },
  serviceZoneId: { type: String, index: true },
  serviceType: { type: String, enum: ['instant', 'scheduled', 'airport', 'intercity', 'hourly', 'corporate'], required: true, index: true },
  currency: { type: String, required: true, uppercase: true, trim: true },
  baseFare: { type: Number, required: true, min: 0 },
  perKilometer: { type: Number, required: true, min: 0 },
  perMinute: { type: Number, required: true, min: 0 },
  minimumFare: { type: Number, required: true, min: 0 },
  bookingFee: { type: Number, min: 0, default: 0 },
  airportFee: { type: Number, min: 0, default: 0 },
  scheduledFee: { type: Number, min: 0, default: 0 },
  intercityMinimumKm: { type: Number, min: 0, default: 0 },
  waitingPerMinute: { type: Number, min: 0, default: 0 },
  cancellationFee: { type: Number, min: 0, default: 0 },
  noShowFee: { type: Number, min: 0, default: 0 },
  nightMultiplier: { type: Number, min: 1, default: 1 },
  surgeMin: { type: Number, min: 1, default: 1 },
  surgeMax: { type: Number, min: 1, default: 1 },
  taxPercent: { type: Number, min: 0, max: 100, default: 0 },
  status: { type: String, enum: ['active', 'paused', 'archived'], default: 'active', index: true },
}, { timestamps: true });
taxiFareRuleSchema.index({ companyId: 1, vehicleClassId: 1, serviceZoneId: 1, serviceType: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['active', 'paused'] } } });
module.exports = model('TaxiFareRule', taxiFareRuleSchema);

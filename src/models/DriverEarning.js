const { Schema, model } = require('./_helpers');
const driverEarningSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  companyId: { type: String, required: true, index: true },
  driverProfileId: { type: String, required: true, index: true },
  rideId: { type: String, required: true, unique: true, index: true },
  bookingRef: { type: String, required: true, index: true },
  currency: { type: String, required: true, uppercase: true, trim: true },
  grossFare: { type: Number, required: true, min: 0 },
  platformCommission: { type: Number, required: true, min: 0 },
  companyShare: { type: Number, required: true, min: 0 },
  driverShare: { type: Number, required: true, min: 0 },
  driverPayoutPercent: { type: Number, min: 0, max: 100, default: 100 },
  adjustments: [Schema.Types.Mixed],
  status: { type: String, enum: ['pending_payment', 'pending_fulfillment', 'eligible', 'settled', 'reversed'], default: 'pending_payment', index: true },
  eligibleAt: Date,
  settledAt: Date,
}, { timestamps: true });
module.exports = model('DriverEarning', driverEarningSchema);

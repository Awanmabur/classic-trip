const { Schema, model } = require('./_helpers');

const commissionSchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  bookingId: { type: String, required: true, index: true },
  bookingRef: { type: String, index: true },
  promoterId: { type: String, index: true },
  companyId: { type: String, index: true },
  commercialModel: { type: String, enum: ['percentage_commission'], default: 'percentage_commission' },
  partnerCommissionPercent: { type: Number, min: 0, max: 100 },
  partnerPayoutPercent: { type: Number, min: 0, max: 100 },
  promoterSharePercent: { type: Number, min: 0, max: 100, default: 0 },
  totalCommission: Number,
  platformFee: Number,
  promoterAmount: Number,
  companyAmount: Number,
  status: { type: String, default: 'pending', index: true, enum: ['pending', 'released', 'cancelled', 'partially_refunded'] },
  releasedAt: Date,
}, { timestamps: true });

module.exports = model('Commission', commissionSchema);

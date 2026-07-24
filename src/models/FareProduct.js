const { Schema, model } = require('./_helpers');

const fareProductSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  listingId: { type: String, required: true, index: true },
  routeId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true },
  fareClass: { type: String, enum: ['standard', 'economy', 'business', 'executive', 'vip', 'premium', 'express'], default: 'standard', index: true },
  currency: { type: String, required: true, uppercase: true, trim: true },
  refundable: { type: Boolean, default: false },
  changeable: { type: Boolean, default: false },
  baggageAllowanceKg: { type: Number, default: 0, min: 0 },
  cancellationPolicyId: { type: String, index: true },
  baggagePolicyId: { type: String, index: true },
  salesStartAt: Date,
  salesEndAt: Date,
  status: { type: String, enum: ['draft', 'active', 'paused', 'archived'], default: 'draft', index: true },
  createdBy: String,
  updatedBy: String,
}, { timestamps: true });

fareProductSchema.index({ companyId: 1, routeId: 1, status: 1 });
module.exports = model('FareProduct', fareProductSchema);

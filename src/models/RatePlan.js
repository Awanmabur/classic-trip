const { Schema, model } = require('./_helpers');

const ratePlanSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  listingId: { type: String, required: true, index: true },
  propertyId: { type: String, required: true, index: true },
  roomTypeId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  code: { type: String, required: true },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
  pricingMode: { type: String, enum: ['fixed', 'nightly_inventory'], default: 'nightly_inventory' },
  basePrice: { type: Number, required: true, min: 0 },
  mealPlan: { type: String, enum: ['room_only', 'breakfast', 'half_board', 'full_board', 'all_inclusive'], default: 'room_only' },
  refundable: { type: Boolean, default: true },
  cancellationDeadlineHours: { type: Number, default: 24, min: 0 },
  cancellationPenaltyType: { type: String, enum: ['none', 'first_night', 'percentage', 'full_stay'], default: 'first_night' },
  cancellationPenaltyValue: { type: Number, default: 0, min: 0 },
  paymentTiming: { type: String, enum: ['pay_now'], default: 'pay_now' },
  depositType: { type: String, enum: ['none'], default: 'none' },
  depositAmount: { type: Number, default: 0, min: 0 },
  minStay: { type: Number, default: 1, min: 1 },
  maxStay: { type: Number, default: 90, min: 1 },
  extraAdultFee: { type: Number, default: 0, min: 0 },
  extraChildFee: { type: Number, default: 0, min: 0 },
  includedAdults: { type: Number, default: 1, min: 0 },
  includedChildren: { type: Number, default: 0, min: 0 },
  policySnapshot: Schema.Types.Mixed,
  status: { type: String, enum: ['active', 'paused', 'archived'], default: 'active', index: true },
  createdBy: String,
  updatedBy: String,
}, { timestamps: true });
ratePlanSchema.index({ companyId: 1, roomTypeId: 1, code: 1 }, { unique: true });
module.exports = model('RatePlan', ratePlanSchema);

const { Schema, model } = require('./_helpers');

const scheduleRuleSchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  companyId: { type: String, required: true, index: true },
  listingId: { type: String, index: true },
  routeId: { type: String, required: true, index: true },
  vehicleId: { type: String, required: true, index: true },
  seatMapTemplateId: { type: String, index: true },
  seatMapVersionId: { type: String, index: true },
  fareProductId: { type: String, index: true },
  timezone: { type: String, default: 'Africa/Kampala' },
  departureTime: { type: String, required: true },
  daysOfWeek: [Number],
  startDate: { type: Date, required: true },
  endDate: Date,
  durationMinutes: Number,
  basePrice: Number,
  fareClass: { type: String, enum: ['standard', 'economy', 'business', 'executive', 'vip', 'premium', 'express'] },
  notes: String,
  blockedSeats: [String],
  driverIds: [String],
  vipPriceDelta: Number,
  status: { type: String, default: 'draft', index: true, enum: ['draft', 'active', 'paused', 'cancelled'] },
  // Observability watermark for the furthest checked date. The daily job still
  // rechecks the complete live window so deleted or previously skipped dates
  // can be repaired safely.
  materializedThrough: Date,
  materializationBlockedAt: Date,
  materializationBlockedUntil: { type: Date, index: true },
  materializationBlockerCode: { type: String, index: true },
  materializationBlockerReason: String,
  materializationBlockerFailures: [String],
  materializationBlockerRuleIds: [{ type: String }],
  materializationRequiresAction: { type: Boolean, default: false, index: true },
  materializationStateUpdatedAt: Date,
  createdBy: String,
  updatedBy: String,
}, { timestamps: true });

scheduleRuleSchema.index({ companyId: 1, status: 1, startDate: 1 });
scheduleRuleSchema.index({ companyId: 1, updatedAt: -1 });

module.exports = model('ScheduleRule', scheduleRuleSchema);

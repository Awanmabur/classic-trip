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
  // Every schedule up to and including this date has already been materialized; the daily job
  // only ever extends this watermark forward, never re-scans from startDate.
  materializedThrough: Date,
  createdBy: String,
  updatedBy: String,
}, { timestamps: true });

module.exports = model('ScheduleRule', scheduleRuleSchema);

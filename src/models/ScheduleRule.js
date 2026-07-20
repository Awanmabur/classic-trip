const { Schema, model } = require('./_helpers');

const scheduleRuleSchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  companyId: { type: String, required: true, index: true },
  listingId: { type: String, index: true },
  routeId: { type: String, required: true, index: true },
  vehicleId: { type: String, required: true, index: true },
  departureTime: { type: String, required: true },
  daysOfWeek: [Number],
  startDate: { type: Date, required: true },
  endDate: Date,
  durationMinutes: Number,
  basePrice: Number,
  fareClass: String,
  notes: String,
  blockedSeats: [String],
  driverIds: [String],
  vipPriceDelta: Number,
  status: { type: String, default: 'active', index: true },
  // Every schedule up to and including this date has already been materialized; the daily job
  // only ever extends this watermark forward, never re-scans from startDate.
  materializedThrough: Date,
  createdBy: String,
  updatedBy: String,
}, { timestamps: true });

module.exports = model('ScheduleRule', scheduleRuleSchema);

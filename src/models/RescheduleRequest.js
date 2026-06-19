const { Schema, model } = require('./_helpers');

const rescheduleRequestSchema = new Schema({
  id: { type: String, index: true },
  bookingId: { type: String, index: true },
  bookingRef: { type: String, index: true },
  companyId: { type: String, index: true },
  customerUserId: { type: String, index: true },
  requesterId: { type: String, index: true },
  currentScheduleId: { type: String, index: true },
  requestedScheduleId: { type: String, index: true },
  preferredDate: Date,
  preferredTime: String,
  reason: String,
  status: { type: String, default: 'pending', index: true },
  reviewNote: String,
  reviewedBy: String,
  reviewedAt: Date,
  approvedScheduleId: { type: String, index: true },
  appliedAt: Date,
  metadata: Schema.Types.Mixed,
}, { timestamps: true });

rescheduleRequestSchema.index({ companyId: 1, status: 1, createdAt: -1 });
rescheduleRequestSchema.index({ bookingRef: 1, status: 1 });
module.exports = model('RescheduleRequest', rescheduleRequestSchema);

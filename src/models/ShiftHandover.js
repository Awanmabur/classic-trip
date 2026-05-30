const { Schema, model } = require('./_helpers');

const shiftHandoverSchema = new Schema({
  id: { type: String, index: true },
  userId: { type: String, required: true, index: true },
  userName: String,
  companyId: { type: String, required: true, index: true },
  tenantId: { type: String, index: true },
  shiftDate: { type: Date, index: true },
  note: String,
  notes: String,
  cashCollected: { type: Number, default: 0 },
  bookingsHandled: { type: Number, default: 0 },
  checkInsHandled: { type: Number, default: 0 },
  paymentsRecorded: { type: Number, default: 0 },
  refundRequestsHandled: { type: Number, default: 0 },
  issues: String,
  status: { type: String, default: 'submitted', index: true },
  reviewedBy: String,
  reviewedAt: Date,
}, { timestamps: true });

shiftHandoverSchema.index({ companyId: 1, shiftDate: -1 });
module.exports = model('ShiftHandover', shiftHandoverSchema);

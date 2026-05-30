const { Schema, model } = require('./_helpers');

const refundRequestSchema = new Schema({
  id: { type: String, index: true },
  bookingId: { type: String, index: true },
  bookingRef: { type: String, index: true },
  paymentId: { type: String, index: true },
  companyId: { type: String, index: true },
  requesterId: { type: String, index: true },
  customerUserId: { type: String, index: true },
  amount: Number,
  currency: { type: String, default: 'UGX' },
  reason: String,
  status: { type: String, default: 'pending', index: true },
  requestedAt: Date,
  reviewedBy: String,
  reviewedAt: Date,
  approvedBy: String,
  approvedAt: Date,
  rejectedBy: String,
  rejectedAt: Date,
  rejectionReason: String,
  notes: String,
  metadata: Schema.Types.Mixed,
}, { timestamps: true });

refundRequestSchema.index({ companyId: 1, status: 1, createdAt: -1 });
refundRequestSchema.index({ requesterId: 1, status: 1 });
module.exports = model('RefundRequest', refundRequestSchema);

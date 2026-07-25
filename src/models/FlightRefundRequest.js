const { Schema, model } = require('./_helpers');
const flightRefundRequestSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  requestRef: { type: String, required: true, unique: true, index: true },
  orderId: { type: String, required: true, index: true },
  bookingRef: { type: String, required: true, index: true },
  agentCompanyId: { type: String, index: true },
  requestedByUserId: { type: String, index: true },
  reason: { type: String, required: true },
  requestedAmount: Number,
  currency: String,
  supplierResponse: Schema.Types.Mixed,
  status: { type: String, enum: ['submitted', 'under_review', 'approved', 'rejected', 'processing', 'refunded', 'cancelled'], default: 'submitted', index: true },
  reviewedBy: String,
  reviewedAt: Date,
}, { timestamps: true });
flightRefundRequestSchema.index({ agentCompanyId: 1, status: 1, createdAt: -1 });
module.exports = model('FlightRefundRequest', flightRefundRequestSchema);

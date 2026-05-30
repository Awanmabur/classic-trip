const { Schema, model } = require('./_helpers');

const paymentSchema = new Schema({
  id: { type: String, index: true },
  bookingId: { type: String, required: true, index: true },
  bookingRef: { type: String, index: true },
  companyId: { type: String, index: true },
  customerUserId: { type: String, index: true },
  provider: String,
  providerReference: { type: String, index: true },
  paymentRef: { type: String, index: true },
  methodNote: String,
  amount: Number,
  grossAmount: Number,
  currency: { type: String, default: 'UGX' },
  status: { type: String, default: 'pending', index: true },
  settlementStatus: { type: String, default: 'pending', index: true },
  platformPercent: Number,
  platformAmount: Number,
  promoterPercent: Number,
  promoterAmount: Number,
  ownerAmount: Number,
  paidAt: Date,
  failedAt: Date,
  failureReason: String,
  checkoutUrl: String,
  idempotencyKey: { type: String, index: true },
  rawPayload: Schema.Types.Mixed,
  metadata: Schema.Types.Mixed,
}, { timestamps: true });

paymentSchema.index({ provider: 1, providerReference: 1 });
paymentSchema.index({ companyId: 1, status: 1, createdAt: -1 });
module.exports = model('Payment', paymentSchema);

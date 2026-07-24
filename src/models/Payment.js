const { Schema, model } = require('./_helpers');

const paymentSchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  bookingId: { type: String, required: true, index: true },
  bookingRef: { type: String, index: true },
  companyId: { type: String, index: true },
  customerUserId: { type: String, index: true },
  provider: { type: String, enum: ['pesapal', 'mtn_momo', 'airtel_money', 'flutterwave', 'paystack', 'dpo', 'cash', 'bank_transfer', 'card', 'mobile_money'] },
  providerReference: { type: String, index: true },
  paymentRef: { type: String, index: true },
  methodNote: String,
  amount: Number,
  grossAmount: Number,
  currency: { type: String, required: true, uppercase: true, trim: true },
  status: { type: String, default: 'pending', index: true, enum: ['pending', 'successful', 'failed', 'expired', 'refunded'] },
  settlementStatus: { type: String, default: 'pending', index: true, enum: ['pending', 'settled'] },
  platformPercent: Number,
  platformAmount: Number,
  promoterPercent: Number,
  promoterAmount: Number,
  ownerAmount: Number,
  paidAt: Date,
  failedAt: Date,
  failureReason: String,
  checkoutUrl: String,
  idempotencyKey: { type: String },
  rawPayload: Schema.Types.Mixed,
  metadata: Schema.Types.Mixed,
}, { timestamps: true });

paymentSchema.index({ provider: 1, providerReference: 1 }, { unique: true, sparse: true });
paymentSchema.index({ companyId: 1, status: 1, createdAt: -1 });
paymentSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
module.exports = model('Payment', paymentSchema);

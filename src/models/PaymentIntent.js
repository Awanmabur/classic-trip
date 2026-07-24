const { Schema, model } = require('./_helpers');

const paymentIntentSchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  intentRef: { type: String, index: true },
  bookingId: { type: String, index: true },
  bookingRef: { type: String, index: true },
  cartRef: { type: String, index: true },
  companyId: { type: String, index: true },
  customerUserId: { type: String, index: true },
  provider: { type: String, enum: ['pesapal', 'cash', 'mtn_momo', 'airtel_money', 'flutterwave', 'paystack', 'dpo', 'bank_transfer', 'card', 'mobile_money'] },
  providerReference: { type: String, index: true },
  idempotencyKey: { type: String },
  amount: Number,
  currency: { type: String, required: true, uppercase: true, trim: true },
  status: { type: String, default: 'created', index: true, enum: ['created', 'pending', 'processing', 'successful', 'failed', 'expired', 'cancelled'] },
  checkoutUrl: String,
  expiresAt: Date,
  paidAt: Date,
  failedAt: Date,
  failureReason: String,
  attempts: [Schema.Types.Mixed],
  metadata: Schema.Types.Mixed,
}, { timestamps: true });

paymentIntentSchema.index({ provider: 1, providerReference: 1 }, { unique: true, sparse: true });
paymentIntentSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
module.exports = model('PaymentIntent', paymentIntentSchema);

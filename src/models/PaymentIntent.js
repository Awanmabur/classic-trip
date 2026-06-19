const { Schema, model } = require('./_helpers');

const paymentIntentSchema = new Schema({
  id: { type: String, index: true },
  intentRef: { type: String, index: true },
  bookingId: { type: String, index: true },
  bookingRef: { type: String, index: true },
  cartRef: { type: String, index: true },
  companyId: { type: String, index: true },
  customerUserId: { type: String, index: true },
  provider: String,
  providerReference: { type: String, index: true },
  idempotencyKey: { type: String, index: true },
  amount: Number,
  currency: { type: String, default: 'UGX' },
  status: { type: String, default: 'created', index: true },
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

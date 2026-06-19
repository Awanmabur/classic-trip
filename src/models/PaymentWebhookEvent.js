const { Schema, model } = require('./_helpers');

const paymentWebhookEventSchema = new Schema({
  id: { type: String, index: true },
  provider: { type: String, index: true },
  providerReference: { type: String, index: true },
  bookingRef: { type: String, index: true },
  idempotencyKey: { type: String, index: true },
  status: { type: String, default: 'received', index: true },
  signatureStatus: { type: String, default: 'unchecked', index: true },
  amount: Number,
  currency: String,
  eventType: String,
  processedAt: Date,
  failureReason: String,
  rawPayload: Schema.Types.Mixed,
  rawBodyHash: String,
}, { timestamps: true });

paymentWebhookEventSchema.index({ provider: 1, idempotencyKey: 1 }, { unique: true, sparse: true });
paymentWebhookEventSchema.index({ provider: 1, providerReference: 1, status: 1 });
module.exports = model('PaymentWebhookEvent', paymentWebhookEventSchema);

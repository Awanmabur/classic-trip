const { Schema, model } = require('./_helpers');

const cartCheckoutAttemptSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  cartRef: { type: String, index: true },
  bookingRef: { type: String, index: true },
  paymentId: { type: String, index: true },
  providerReference: { type: String, index: true },
  status: { type: String, default: 'started', index: true },
  failureType: String,
  failureReason: String,
  recoveryAction: String,
  recoveryUrl: String,
  inventorySnapshot: [Schema.Types.Mixed],
  pricingSnapshot: Schema.Types.Mixed,
  createdBy: String,
  resolvedAt: Date,
}, { timestamps: true });

cartCheckoutAttemptSchema.index({ cartRef: 1, createdAt: -1 });

module.exports = model('CartCheckoutAttempt', cartCheckoutAttemptSchema);

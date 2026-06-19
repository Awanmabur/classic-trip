const { Schema, model } = require('./_helpers');

const subscriptionOrderSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  orderRef: { type: String, unique: true, required: true, index: true },
  orderType: { type: String, default: 'onboarding', index: true },
  companyId: { type: String, required: true, index: true },
  companySlug: { type: String, index: true },
  companyName: String,
  planId: { type: String, required: true, index: true },
  planName: String,
  amount: Number,
  currency: { type: String, default: 'UGX' },
  interval: String,
  status: { type: String, default: 'pending_payment', index: true },
  paymentStatus: { type: String, default: 'pending', index: true },
  provider: String,
  providerReference: { type: String, index: true },
  checkoutUrl: String,
  contact: Schema.Types.Mixed,
  subscriptionId: { type: String, index: true },
  createdBy: String,
  activatedAt: Date,
  expiresAt: Date,
  meta: Schema.Types.Mixed,
}, { timestamps: true });

subscriptionOrderSchema.index({ companyId: 1, createdAt: -1 });
subscriptionOrderSchema.index({ provider: 1, providerReference: 1 });

module.exports = model('SubscriptionOrder', subscriptionOrderSchema);

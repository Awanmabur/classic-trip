const { Schema, model } = require('./_helpers');

const subscriptionOrderSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  orderRef: { type: String, unique: true, required: true, index: true },
  orderType: { type: String, default: 'onboarding', index: true, enum: ['onboarding', 'upgrade'] },
  companyId: { type: String, required: true, index: true },
  companySlug: { type: String, index: true },
  companyName: String,
  planId: { type: String, required: true, index: true },
  planName: String,
  amount: Number,
  currency: { type: String, required: true, uppercase: true, trim: true },
  interval: { type: String, enum: ['month', 'quarter', 'year', 'one_time'] },
  planSnapshot: Schema.Types.Mixed,
  status: { type: String, default: 'pending_payment', index: true, enum: ['pending_payment', 'active', 'paid', 'failed'] },
  paymentStatus: { type: String, default: 'pending', index: true, enum: ['pending', 'successful', 'failed'] },
  provider: { type: String, enum: ['pesapal', 'mtn_momo', 'airtel_money', 'flutterwave', 'paystack', 'dpo', 'cash', 'bank_transfer', 'card', 'mobile_money'] },
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

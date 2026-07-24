const { Schema, model } = require('./_helpers');

const subscriptionSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  companySlug: { type: String, index: true },
  planId: { type: String, required: true, index: true },
  planName: String,
  amount: Number,
  currency: { type: String, required: true, uppercase: true, trim: true },
  interval: { type: String, enum: ['month', 'quarter', 'year', 'one_time'] },
  planSnapshot: Schema.Types.Mixed,
  status: { type: String, default: 'active', index: true, enum: ['active', 'replaced'] },
  orderRef: { type: String, index: true },
  paymentId: { type: String, index: true },
  providerReference: { type: String, index: true },
  startedAt: { type: Date, index: true },
  endedAt: Date,
  currentPeriodStart: Date,
  currentPeriodEnd: { type: Date, index: true },
  limits: Schema.Types.Mixed,
  meta: Schema.Types.Mixed,
}, { timestamps: true });

subscriptionSchema.index({ companyId: 1, status: 1, startedAt: -1 });
subscriptionSchema.index({ orderRef: 1, status: 1 });

module.exports = model('Subscription', subscriptionSchema);

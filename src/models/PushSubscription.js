const { Schema, model } = require('./_helpers');

const pushSubscriptionSchema = new Schema({
  id: { type: String, index: true, unique: true },
  userId: { type: String, index: true },
  userRole: { type: String, index: true },
  companyId: { type: String, index: true },
  endpoint: { type: String, index: true },
  expirationTime: Schema.Types.Mixed,
  keys: Schema.Types.Mixed,
  status: { type: String, default: 'active', index: true },
  userAgent: String,
  lastSeenAt: Date,
  lastSentAt: Date,
  revokedAt: Date,
  expiredAt: Date,
}, { timestamps: true });

pushSubscriptionSchema.index({ userId: 1, status: 1 });
pushSubscriptionSchema.index({ companyId: 1, status: 1 });

module.exports = model('PushSubscription', pushSubscriptionSchema);
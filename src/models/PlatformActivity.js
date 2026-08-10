const { Schema, model } = require('./_helpers');

const platformActivitySchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  visitorId: { type: String, index: true },
  sessionKey: { type: String, index: true },
  userId: { type: String, index: true },
  userRole: { type: String, index: true },
  authenticated: { type: Boolean, default: false, index: true },
  eventType: { type: String, enum: ['page_view', 'action'], index: true },
  method: { type: String, index: true },
  path: { type: String, index: true },
  pageGroup: { type: String, index: true },
  actionName: { type: String, index: true },
  statusCode: { type: Number, index: true },
  durationMs: Number,
  referrerHost: String,
  deviceType: { type: String, enum: ['mobile', 'tablet', 'desktop', 'bot', 'unknown'], default: 'unknown', index: true },
  browserHint: String,
  requestId: String,
  occurredAt: { type: Date, default: Date.now, index: true },
  // TTL index is declared explicitly below; do not also set index:true here.
  expiresAt: { type: Date },
}, { timestamps: true });

platformActivitySchema.index({ occurredAt: -1, eventType: 1 });
platformActivitySchema.index({ visitorId: 1, occurredAt: -1 });
platformActivitySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = model('PlatformActivity', platformActivitySchema);

const { Schema, model } = require('./_helpers');

const deviceSessionSchema = new Schema({
  id: { type: String, index: true },
  userId: { type: String, index: true },
  role: { type: String, index: true },
  sessionHash: { type: String, index: true },
  deviceFingerprint: { type: String, index: true },
  ip: String,
  userAgent: String,
  firstSeenAt: Date,
  lastSeenAt: Date,
  revokedAt: Date,
  status: { type: String, enum: ['active', 'revoked', 'expired'], default: 'active', index: true },
  metadata: Schema.Types.Mixed,
}, { timestamps: true });

deviceSessionSchema.index({ userId: 1, status: 1, lastSeenAt: -1 });
module.exports = model('DeviceSession', deviceSessionSchema);

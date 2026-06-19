const { Schema, model } = require('./_helpers');

const loginAuditSchema = new Schema({
  id: { type: String, index: true },
  userId: { type: String, index: true },
  identity: { type: String, index: true },
  role: { type: String, index: true },
  result: { type: String, enum: ['success', 'failure', 'blocked'], index: true },
  reason: String,
  ip: String,
  userAgent: String,
  deviceFingerprint: String,
  deviceSessionId: String,
  riskScore: { type: Number, default: 0 },
  metadata: Schema.Types.Mixed,
}, { timestamps: true });

loginAuditSchema.index({ userId: 1, createdAt: -1 });
loginAuditSchema.index({ identity: 1, createdAt: -1 });
module.exports = model('LoginAudit', loginAuditSchema);

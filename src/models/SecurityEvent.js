const { Schema, model } = require('./_helpers');

const securityEventSchema = new Schema({
  id: { type: String, index: true },
  eventType: { type: String, index: true },
  severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'low', index: true },
  actorId: { type: String, index: true },
  actorRole: { type: String, index: true, enum: ['super_admin', 'admin', 'finance_admin', 'support_admin', 'operations_admin', 'content_admin', 'company_admin', 'company_employee', 'driver', 'customer', 'promoter', 'guest', ''] },
  entityType: String,
  entityId: String,
  status: { type: String, default: 'recorded', index: true },
  reason: String,
  ip: String,
  userAgent: String,
  requestId: String,
  metadata: Schema.Types.Mixed,
}, { timestamps: true });

securityEventSchema.index({ eventType: 1, createdAt: -1 });
securityEventSchema.index({ severity: 1, createdAt: -1 });
module.exports = model('SecurityEvent', securityEventSchema);

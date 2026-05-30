const { Schema, model } = require('./_helpers');

const auditLogSchema = new Schema({
  id: { type: String, index: true },
  actorId: { type: String, index: true },
  actorName: String,
  actorEmail: String,
  actorRole: { type: String, index: true },
  action: { type: String, index: true },
  entityType: { type: String, index: true },
  entityId: { type: String, index: true },
  target: String,
  beforeSummary: Schema.Types.Mixed,
  afterSummary: Schema.Types.Mixed,
  metadata: Schema.Types.Mixed,
  ip: String,
  userAgent: String,
  status: { type: String, default: 'success', index: true },
}, { timestamps: true });

auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
module.exports = model('AuditLog', auditLogSchema);

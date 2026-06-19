const { Schema, model } = require('./_helpers');

const idempotencyKeyRecordSchema = new Schema({
  id: { type: String, index: true },
  key: { type: String, index: true },
  scope: { type: String, index: true },
  entityType: String,
  entityId: String,
  payloadHash: String,
  responseHash: String,
  status: { type: String, enum: ['started', 'completed', 'failed', 'replayed'], default: 'started', index: true },
  firstSeenAt: Date,
  lastSeenAt: Date,
  expiresAt: Date,
  metadata: Schema.Types.Mixed,
}, { timestamps: true });

idempotencyKeyRecordSchema.index({ key: 1, scope: 1 }, { unique: true });
module.exports = model('IdempotencyKeyRecord', idempotencyKeyRecordSchema);

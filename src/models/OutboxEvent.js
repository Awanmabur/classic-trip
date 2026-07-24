const { Schema, model } = require('./_helpers');

const outboxEventSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  topic: { type: String, required: true, index: true },
  aggregateType: { type: String, required: true, index: true },
  aggregateId: { type: String, required: true, index: true },
  tenantId: { type: String, index: true },
  companyId: { type: String, index: true },
  dedupeKey: { type: String, unique: true, sparse: true, index: true },
  payload: Schema.Types.Mixed,
  headers: Schema.Types.Mixed,
  status: {
    type: String,
    enum: ['pending', 'processing', 'processed', 'failed', 'dead_letter'],
    default: 'pending',
    index: true,
  },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 8 },
  availableAt: { type: Date, default: Date.now, index: true },
  lockedAt: Date,
  lockOwner: String,
  processedAt: Date,
  failedAt: Date,
  lastError: String,
}, { timestamps: true });

outboxEventSchema.index({ status: 1, availableAt: 1, createdAt: 1 });
outboxEventSchema.index({ aggregateType: 1, aggregateId: 1, topic: 1 });

module.exports = model('OutboxEvent', outboxEventSchema);

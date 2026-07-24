const { Schema, model } = require('./_helpers');

const payoutBatchSchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  batchNumber: { type: String, index: true },
  settlementBatchId: String,
  currency: { type: String, required: true, uppercase: true, trim: true },
  ownerType: { type: String, enum: ['mixed', 'company', 'promoter', 'platform'] },
  status: { type: String, default: 'exported', index: true, enum: ['exported'] },
  createdBy: String,
  createdAt: Date,
  approvedBy: String,
  approvedAt: Date,
  exportedAt: Date,
  providerReference: String,
  totalAmount: { type: Number, default: 0 },
  requestIds: [String],
  rows: [Schema.Types.Mixed],
  notes: String,
}, { timestamps: true });

module.exports = model('PayoutBatch', payoutBatchSchema);

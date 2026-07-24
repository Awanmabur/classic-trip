const { Schema, model } = require('./_helpers');

const settlementBatchSchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  batchNumber: { type: String, index: true },
  periodStart: Date,
  periodEnd: Date,
  currency: { type: String, required: true, uppercase: true, trim: true },
  status: { type: String, default: 'draft', index: true, enum: ['draft', 'reviewed'] },
  createdBy: String,
  reviewedBy: String,
  reviewedAt: Date,
  exportedAt: Date,
  totalGross: { type: Number, default: 0 },
  totalCompanyEarning: { type: Number, default: 0 },
  totalPromoterCommission: { type: Number, default: 0 },
  totalPlatformFee: { type: Number, default: 0 },
  totalRefundDebits: { type: Number, default: 0 },
  totalPayable: { type: Number, default: 0 },
  rows: [Schema.Types.Mixed],
  notes: String,
}, { timestamps: true });

module.exports = model('SettlementBatch', settlementBatchSchema);

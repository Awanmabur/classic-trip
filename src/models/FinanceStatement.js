const { Schema, model } = require('./_helpers');

const financeStatementSchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  statementRef: { type: String, index: true },
  ownerType: { type: String, index: true, enum: ['company', 'platform', 'promoter'] },
  ownerId: { type: String, index: true },
  settlementBatchId: { type: String, index: true },
  payoutBatchId: { type: String, index: true },
  periodStart: Date,
  periodEnd: Date,
  currency: { type: String, required: true, uppercase: true, trim: true },
  gross: Number,
  platformFee: Number,
  companyEarning: Number,
  promoterCommission: Number,
  refundDebits: Number,
  payoutTotal: Number,
  openingBalance: Number,
  closingBalance: Number,
  status: { type: String, default: 'draft', index: true, enum: ['draft', 'issued'] },
  generatedBy: String,
  generatedAt: Date,
  rows: [Schema.Types.Mixed],
  notes: String,
}, { timestamps: true });

financeStatementSchema.index({ ownerType: 1, ownerId: 1, periodEnd: -1 });
module.exports = model('FinanceStatement', financeStatementSchema);

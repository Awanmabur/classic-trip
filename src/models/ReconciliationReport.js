const { Schema, model } = require('./_helpers');

const reconciliationReportSchema = new Schema({
  id: { type: String, index: true },
  settlementBatchId: String,
  payoutBatchId: String,
  periodStart: Date,
  periodEnd: Date,
  status: { type: String, default: 'balanced', index: true },
  createdBy: String,
  createdAt: Date,
  grossPayments: { type: Number, default: 0 },
  refundDebits: { type: Number, default: 0 },
  companyEarnings: { type: Number, default: 0 },
  promoterCommissions: { type: Number, default: 0 },
  platformFees: { type: Number, default: 0 },
  requestedPayouts: { type: Number, default: 0 },
  completedPayouts: { type: Number, default: 0 },
  variance: { type: Number, default: 0 },
  findings: [Schema.Types.Mixed],
  notes: String,
}, { timestamps: true });

module.exports = model('ReconciliationReport', reconciliationReportSchema);

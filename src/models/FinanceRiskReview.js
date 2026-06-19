const { Schema, model } = require('./_helpers');

const financeRiskReviewSchema = new Schema({
  id: { type: String, index: true },
  targetType: { type: String, index: true },
  targetId: { type: String, index: true },
  ownerType: String,
  ownerId: String,
  amount: Number,
  currency: { type: String, default: 'UGX' },
  riskScore: Number,
  flags: [String],
  status: { type: String, default: 'clear', index: true },
  reviewedBy: String,
  reviewedAt: Date,
  notes: String,
  metadata: Schema.Types.Mixed,
}, { timestamps: true });

module.exports = model('FinanceRiskReview', financeRiskReviewSchema);

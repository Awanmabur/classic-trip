const { Schema, model } = require('./_helpers');

const financeRiskReviewSchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  targetType: { type: String, index: true, enum: ['payout_request'] },
  targetId: { type: String, index: true },
  ownerType: String,
  ownerId: String,
  amount: Number,
  currency: { type: String, required: true, uppercase: true, trim: true },
  riskScore: Number,
  flags: [String],
  status: { type: String, default: 'clear', index: true, enum: ['clear', 'hold_recommended'] },
  reviewedBy: String,
  reviewedAt: Date,
  notes: String,
  metadata: Schema.Types.Mixed,
}, { timestamps: true });

module.exports = model('FinanceRiskReview', financeRiskReviewSchema);

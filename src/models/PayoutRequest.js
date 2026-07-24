const { Schema, model } = require('./_helpers');

const payoutRequestSchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  ownerType: { type: String, index: true, enum: ['company', 'promoter'] },
  ownerId: { type: String, index: true },
  walletId: String,
  transactionId: { type: String, index: true },
  settlementBatchId: String,
  payoutBatchId: String,
  amount: Number,
  currency: { type: String, required: true, uppercase: true, trim: true },
  payoutMethod: { type: String, enum: ['Mobile Money', 'Bank', 'Wallet'] },
  payoutAccount: String,
  status: { type: String, default: 'requested', index: true, enum: ['requested', 'held', 'approved', 'rejected'] },
  requestedBy: String,
  requestedAt: Date,
  reviewedBy: String,
  reviewedAt: Date,
  rejectionReason: String,
  holdReason: String,
  providerReference: String,
  riskReviewId: { type: String, index: true },
  riskStatus: { type: String, enum: ['clear', 'hold_recommended'] },
  exportReference: String,
  notes: String,
}, { timestamps: true });

module.exports = model('PayoutRequest', payoutRequestSchema);

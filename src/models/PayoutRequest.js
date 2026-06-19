const { Schema, model } = require('./_helpers');

const payoutRequestSchema = new Schema({
  id: { type: String, index: true },
  ownerType: { type: String, index: true },
  ownerId: { type: String, index: true },
  walletId: String,
  transactionId: { type: String, index: true },
  settlementBatchId: String,
  payoutBatchId: String,
  amount: Number,
  currency: { type: String, default: 'UGX' },
  payoutMethod: String,
  payoutAccount: String,
  status: { type: String, default: 'requested', index: true },
  requestedBy: String,
  requestedAt: Date,
  reviewedBy: String,
  reviewedAt: Date,
  rejectionReason: String,
  holdReason: String,
  providerReference: String,
  exportReference: String,
  notes: String,
}, { timestamps: true });

module.exports = model('PayoutRequest', payoutRequestSchema);

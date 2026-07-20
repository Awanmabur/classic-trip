const { Schema, model } = require('./_helpers');

const walletTransactionSchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  walletId: { type: String, index: true },
  ownerType: { type: String, index: true },
  ownerId: { type: String, index: true },
  transactionType: { type: String, index: true },
  direction: { type: String, enum: ['credit', 'debit'] },
  amount: Number,
  currency: { type: String, default: 'UGX' },
  status: { type: String, default: 'pending', index: true },
  method: String,
  reference: String,
  payoutMethod: String,
  payoutAccount: String,
  holdReason: String,
  reviewReason: String,
  approvedBy: String,
  approvedAt: Date,
  reviewedBy: String,
  reviewedAt: Date,
  referenceType: String,
  referenceId: String,
  sourceReferenceType: String,
  sourceReferenceId: String,
  pendingDebit: Number,
  availableDebit: Number,
  uncoveredAmount: Number,
  meta: Schema.Types.Mixed,
}, { timestamps: true });

module.exports = model('WalletTransaction', walletTransactionSchema);

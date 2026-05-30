const { Schema, model } = require('./_helpers');

const walletTransactionSchema = new Schema({
  id: { type: String, index: true },
  walletId: { type: String, index: true },
  ownerType: { type: String, index: true },
  ownerId: { type: String, index: true },
  transactionType: { type: String, index: true },
  direction: { type: String, enum: ['credit', 'debit'] },
  amount: Number,
  currency: { type: String, default: 'UGX' },
  status: { type: String, default: 'pending', index: true },
  referenceType: String,
  referenceId: String,
}, { timestamps: true });

module.exports = model('WalletTransaction', walletTransactionSchema);

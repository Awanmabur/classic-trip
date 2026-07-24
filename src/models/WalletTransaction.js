const { Schema, model } = require('./_helpers');

const walletTransactionSchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  walletId: { type: String, index: true },
  ownerType: { type: String, index: true, enum: ['platform', 'company', 'promoter', 'customer'] },
  ownerId: { type: String, index: true },
  transactionType: { type: String, index: true, enum: ['platform_fee', 'company_earning_pending', 'company_earning_released', 'promoter_commission_pending', 'promoter_commission_released', 'wallet_top_up_request', 'wallet_top_up_approved', 'wallet_top_up_rejected', 'withdrawal_request', 'withdrawal_reversal', 'refund_credit', 'refund_debit', 'earning_pending', 'credit', 'debit', 'cart_platform_fee', 'cart_company_earning_pending', 'cart_promoter_commission_pending'] },
  direction: { type: String, enum: ['credit', 'debit'] },
  amount: Number,
  currency: { type: String, required: true, uppercase: true, trim: true },
  status: { type: String, default: 'pending', index: true, enum: ['pending', 'completed', 'rejected', 'held', 'paid'] },
  method: String,
  reference: String,
  payoutMethod: { type: String, enum: ['Mobile Money', 'Bank', 'Wallet'] },
  payoutAccount: String,
  holdReason: String,
  reviewReason: String,
  approvedBy: String,
  approvedAt: Date,
  reviewedBy: String,
  reviewedAt: Date,
  referenceType: { type: String, enum: ['booking', 'cart_booking', 'refund', 'payout', 'wallet', 'withdrawal'] },
  referenceId: String,
  sourceReferenceType: String,
  sourceReferenceId: String,
  pendingDebit: Number,
  availableDebit: Number,
  uncoveredAmount: Number,
  meta: Schema.Types.Mixed,
}, { timestamps: true });

walletTransactionSchema.index({ ownerType: 1, ownerId: 1, transactionType: 1, referenceType: 1, referenceId: 1 }, { unique: true, sparse: true });

module.exports = model('WalletTransaction', walletTransactionSchema);

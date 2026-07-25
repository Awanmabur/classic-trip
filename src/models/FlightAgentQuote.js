const { Schema, model } = require('./_helpers');
const flightAgentQuoteSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  quoteRef: { type: String, required: true, unique: true, index: true },
  publicTokenHash: { type: String, required: true, unique: true, index: true },
  publicTokenEncrypted: String,
  agentCompanyId: { type: String, required: true, index: true },
  agentUserId: { type: String, required: true, index: true },
  offerId: { type: String, required: true, index: true },
  offerTokenEncrypted: String,
  customerName: String,
  customerEmail: { type: String, lowercase: true, trim: true, index: true },
  customerPhone: String,
  travelers: [Schema.Types.Mixed],
  tripSnapshot: Schema.Types.Mixed,
  supplierPriceSnapshot: Schema.Types.Mixed,
  agentFeeSnapshot: Schema.Types.Mixed,
  totalPriceSnapshot: Schema.Types.Mixed,
  notes: String,
  status: { type: String, enum: ['draft', 'sent', 'accepted', 'expired', 'cancelled', 'converted'], default: 'draft', index: true },
  expiresAt: { type: Date, required: true, index: true },
  acceptedAt: Date,
  convertedOrderId: { type: String, index: true },
}, { timestamps: true });
flightAgentQuoteSchema.index({ agentCompanyId: 1, createdAt: -1 });
module.exports = model('FlightAgentQuote', flightAgentQuoteSchema);

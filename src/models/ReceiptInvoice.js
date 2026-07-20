const { Schema, model } = require('./_helpers');

const receiptInvoiceSchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  documentRef: { type: String, index: true },
  documentType: { type: String, enum: ['receipt', 'invoice', 'credit_note'], index: true },
  bookingId: { type: String, index: true },
  bookingRef: { type: String, index: true },
  paymentId: { type: String, index: true },
  companyId: { type: String, index: true },
  customerUserId: { type: String, index: true },
  customerName: String,
  customerEmail: String,
  serviceType: String,
  subtotal: Number,
  fees: Number,
  taxes: Number,
  total: Number,
  currency: { type: String, default: 'UGX' },
  status: { type: String, default: 'issued', index: true },
  issuedAt: Date,
  voidedAt: Date,
  metadata: Schema.Types.Mixed,
}, { timestamps: true });

receiptInvoiceSchema.index({ bookingRef: 1, documentType: 1 });
module.exports = model('ReceiptInvoice', receiptInvoiceSchema);

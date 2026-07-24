const { Schema, model } = require('./_helpers');

const taxFeeRecordSchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  bookingId: { type: String, index: true },
  bookingRef: { type: String },
  paymentId: { type: String, index: true },
  companyId: { type: String, index: true },
  currency: { type: String, required: true, uppercase: true, trim: true },
  subtotal: Number,
  serviceFee: Number,
  taxAmount: Number,
  providerFee: Number,
  totalFees: Number,
  status: { type: String, default: 'recorded', index: true, enum: ['recorded'] },
  recordedAt: Date,
  metadata: Schema.Types.Mixed,
}, { timestamps: true });

taxFeeRecordSchema.index({ bookingRef: 1 });
module.exports = model('TaxFeeRecord', taxFeeRecordSchema);

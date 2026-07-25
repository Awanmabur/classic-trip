const { Schema, model } = require('./_helpers');

const flightSupplierAccessSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  supplierId: { type: String, required: true, index: true },
  status: { type: String, enum: ['pending', 'active', 'suspended', 'revoked'], default: 'pending', index: true },
  permissions: {
    search: { type: Boolean, default: true },
    book: { type: Boolean, default: false },
    ticket: { type: Boolean, default: false },
    exchange: { type: Boolean, default: false },
    refund: { type: Boolean, default: false },
  },
  commissionPercent: { type: Number, default: 0, min: 0, max: 100 },
  markupCapPercent: { type: Number, default: 0, min: 0, max: 100 },
  officeIds: [String],
  activatedAt: Date,
  expiresAt: Date,
  grantedBy: { type: String, index: true },
  notes: String,
}, { timestamps: true });

flightSupplierAccessSchema.index({ companyId: 1, supplierId: 1 }, { unique: true });
module.exports = model('FlightSupplierAccess', flightSupplierAccessSchema);

const { Schema, model } = require('./_helpers');
const flightSupplierSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  companyId: { type: String, index: true },
  airlineId: { type: String, index: true },
  name: { type: String, required: true, trim: true },
  adapterKey: { type: String, required: true, trim: true, index: true },
  mode: { type: String, enum: ['native_inventory', 'external_certified', 'referral_only'], required: true, index: true },
  credentialSecretRef: String,
  webhookSecretRef: String,
  certificationReference: String,
  capabilities: [{ type: String, enum: ['search', 'reprice', 'seat_map', 'order', 'ticket', 'refund', 'exchange', 'schedule_change'] }],
  failClosed: { type: Boolean, default: true },
  status: { type: String, enum: ['draft', 'active', 'paused', 'revoked'], default: 'draft', index: true },
  lastHealthCheckAt: Date,
  lastHealthStatus: String,
}, { timestamps: true });
flightSupplierSchema.index({ companyId: 1, adapterKey: 1 }, { unique: true });
module.exports = model('FlightSupplier', flightSupplierSchema);

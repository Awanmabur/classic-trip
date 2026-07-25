const { Schema, model } = require('./_helpers');
const flightChangeRequestSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  requestRef: { type: String, required: true, unique: true, index: true },
  orderId: { type: String, required: true, index: true },
  bookingRef: { type: String, required: true, index: true },
  agentCompanyId: { type: String, index: true },
  requestedByUserId: { type: String, index: true },
  requestType: { type: String, enum: ['date_change', 'route_change', 'name_correction', 'seat_change', 'baggage_change', 'other'], required: true },
  details: Schema.Types.Mixed,
  supplierResponse: Schema.Types.Mixed,
  status: { type: String, enum: ['submitted', 'under_review', 'quoted', 'approved', 'rejected', 'completed', 'cancelled'], default: 'submitted', index: true },
  reviewedBy: String,
  reviewedAt: Date,
}, { timestamps: true });
flightChangeRequestSchema.index({ agentCompanyId: 1, status: 1, createdAt: -1 });
module.exports = model('FlightChangeRequest', flightChangeRequestSchema);

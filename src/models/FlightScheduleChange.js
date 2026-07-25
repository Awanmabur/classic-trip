const { Schema, model } = require('./_helpers');
const flightScheduleChangeSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  companyId: { type: String, required: true, index: true },
  departureId: { type: String, required: true, index: true },
  supplierId: { type: String, index: true },
  changeType: { type: String, enum: ['time_change', 'aircraft_change', 'terminal_change', 'delay', 'cancellation', 'reroute'], required: true },
  beforeSnapshot: Schema.Types.Mixed,
  afterSnapshot: Schema.Types.Mixed,
  impactLevel: { type: String, enum: ['minor', 'major', 'cancelled'], default: 'minor' },
  status: { type: String, enum: ['detected', 'notified', 'accepted', 'rebooking_required', 'resolved'], default: 'detected', index: true },
  detectedAt: { type: Date, default: Date.now },
  resolvedAt: Date,
}, { timestamps: true });
module.exports = model('FlightScheduleChange', flightScheduleChangeSchema);

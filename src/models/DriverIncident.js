const { Schema, model } = require('./_helpers');

const driverIncidentSchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  companyId: { type: String, required: true, index: true },
  scheduleId: { type: String, index: true },
  bookingRef: { type: String, index: true },
  vehicleId: { type: String, index: true },
  driverUserId: { type: String, index: true },
  category: { type: String, default: 'general', index: true },
  severity: { type: String, default: 'normal', index: true },
  title: String,
  description: String,
  location: String,
  status: { type: String, default: 'open', index: true },
  resolvedBy: String,
  resolvedAt: Date,
  auditTrail: [Schema.Types.Mixed],
}, { timestamps: true });

driverIncidentSchema.index({ companyId: 1, scheduleId: 1, status: 1 });
module.exports = model('DriverIncident', driverIncidentSchema);

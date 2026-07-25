const { Schema, model } = require('./_helpers');
const taxiIncidentSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  companyId: { type: String, required: true, index: true },
  rideId: { type: String, index: true },
  driverProfileId: { type: String, index: true },
  vehicleId: { type: String, index: true },
  reportedBy: { type: String, required: true },
  category: { type: String, enum: ['safety', 'collision', 'harassment', 'lost_item', 'vehicle', 'route', 'payment', 'other'], required: true, index: true },
  severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium', index: true },
  description: { type: String, required: true },
  evidence: [Schema.Types.Mixed],
  status: { type: String, enum: ['open', 'investigating', 'resolved', 'dismissed'], default: 'open', index: true },
  resolution: String,
  resolvedAt: Date,
}, { timestamps: true });
module.exports = model('TaxiIncident', taxiIncidentSchema);

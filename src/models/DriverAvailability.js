const { Schema, model } = require('./_helpers');
const driverAvailabilitySchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  companyId: { type: String, required: true, index: true },
  driverProfileId: { type: String, required: true, unique: true, index: true },
  vehicleId: { type: String, index: true },
  status: { type: String, enum: ['offline', 'available', 'offered', 'assigned', 'on_trip', 'break', 'suspended'], default: 'offline', index: true },
  serviceZoneIds: [{ type: String, index: true }],
  serviceTypes: [String],
  shiftStartedAt: Date,
  shiftEndsAt: Date,
  lastHeartbeatAt: Date,
  version: { type: Number, default: 0 },
}, { timestamps: true });
driverAvailabilitySchema.index({ companyId: 1, status: 1, lastHeartbeatAt: -1 });
module.exports = model('DriverAvailability', driverAvailabilitySchema);

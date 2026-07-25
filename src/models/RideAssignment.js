const { Schema, model } = require('./_helpers');
const rideAssignmentSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  companyId: { type: String, required: true, index: true },
  providerCompanyId: { type: String, required: true, index: true },
  rideId: { type: String, required: true, index: true },
  requestId: { type: String, required: true, index: true },
  driverProfileId: { type: String, required: true, index: true },
  vehicleId: { type: String, required: true, index: true },
  offerExpiresAt: Date,
  offeredAt: Date,
  respondedAt: Date,
  status: { type: String, enum: ['offered', 'accepted', 'declined', 'expired', 'cancelled', 'completed'], default: 'offered', index: true },
  declineReason: String,
  distanceToPickupKm: Number,
  estimatedArrivalMinutes: Number,
}, { timestamps: true });
rideAssignmentSchema.index({ rideId: 1, driverProfileId: 1 }, { unique: true });
rideAssignmentSchema.index({ driverProfileId: 1, status: 1, offerExpiresAt: 1 });
module.exports = model('RideAssignment', rideAssignmentSchema);

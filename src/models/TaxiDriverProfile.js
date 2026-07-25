const { Schema, model } = require('./_helpers');
const taxiDriverProfileSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  companyId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  employeeId: { type: String, index: true },
  driverNumber: { type: String, required: true, trim: true },
  licenceNumberEncrypted: String,
  licenceNumberLast4: String,
  licenceClass: String,
  licenceExpiresAt: Date,
  identityVerified: { type: Boolean, default: false },
  backgroundCheckStatus: { type: String, enum: ['pending', 'clear', 'review', 'failed'], default: 'pending', index: true },
  safetyTrainingCompletedAt: Date,
  assignedVehicleId: { type: String, index: true },
  ratingAverage: Number,
  completedRideCount: { type: Number, min: 0, default: 0 },
  verificationStatus: { type: String, enum: ['pending', 'verified', 'rejected', 'suspended', 'expired'], default: 'pending', index: true },
  availabilityStatus: { type: String, enum: ['offline', 'available', 'offered', 'assigned', 'on_trip', 'break', 'suspended'], default: 'offline', index: true },
}, { timestamps: true });
taxiDriverProfileSchema.index({ companyId: 1, userId: 1 }, { unique: true });
taxiDriverProfileSchema.index({ companyId: 1, driverNumber: 1 }, { unique: true });
module.exports = model('TaxiDriverProfile', taxiDriverProfileSchema);

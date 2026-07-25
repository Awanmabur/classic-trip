const { Schema, mediaSchema, model } = require('./_helpers');
const taxiVehicleSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  companyId: { type: String, required: true, index: true },
  vehicleClassId: { type: String, required: true, index: true },
  registrationNumber: { type: String, required: true, uppercase: true, trim: true, index: true },
  make: { type: String, required: true, trim: true },
  model: { type: String, required: true, trim: true },
  year: Number,
  color: String,
  passengerCapacity: { type: Number, required: true, min: 1 },
  luggageCapacity: { type: Number, min: 0, default: 0 },
  images: [mediaSchema],
  inspectionExpiresAt: Date,
  insuranceExpiresAt: Date,
  registrationExpiresAt: Date,
  verificationStatus: { type: String, enum: ['pending', 'verified', 'rejected', 'expired'], default: 'pending', index: true },
  operationalStatus: { type: String, enum: ['offline', 'available', 'assigned', 'on_trip', 'maintenance', 'suspended', 'archived'], default: 'offline', index: true },
}, { timestamps: true });
taxiVehicleSchema.index({ companyId: 1, registrationNumber: 1 }, { unique: true });
module.exports = model('TaxiVehicle', taxiVehicleSchema);

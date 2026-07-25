const { Schema, model } = require('./_helpers');
const driverLocationSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  companyId: { type: String, required: true, index: true },
  driverProfileId: { type: String, required: true, index: true },
  rideId: { type: String, index: true },
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  accuracyMeters: Number,
  heading: Number,
  speedKph: Number,
  capturedAt: { type: Date, required: true, index: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });
driverLocationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
driverLocationSchema.index({ companyId: 1, driverProfileId: 1, capturedAt: -1 });
module.exports = model('DriverLocation', driverLocationSchema);

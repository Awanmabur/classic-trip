const { Schema, model } = require('./_helpers');
const taxiServiceZoneSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  companyId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true },
  country: { type: String, required: true, trim: true, index: true },
  countryCode: { type: String, uppercase: true, trim: true, index: true },
  city: { type: String, trim: true, index: true },
  district: { type: String, trim: true, index: true },
  zoneType: { type: String, enum: ['city', 'district', 'airport', 'intercity_corridor', 'national', 'custom_polygon', 'radius'], required: true, index: true },
  center: { latitude: Number, longitude: Number },
  radiusKm: Number,
  polygon: [{ latitude: Number, longitude: Number }],
  airportId: { type: String, index: true },
  supportedServiceTypes: [{ type: String, enum: ['instant', 'scheduled', 'airport', 'intercity', 'hourly', 'corporate'] }],
  status: { type: String, enum: ['active', 'paused', 'archived'], default: 'active', index: true },
}, { timestamps: true });
taxiServiceZoneSchema.index({ companyId: 1, name: 1 }, { unique: true });
module.exports = model('TaxiServiceZone', taxiServiceZoneSchema);

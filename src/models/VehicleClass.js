const { Schema, model } = require('./_helpers');
const vehicleClassSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  companyId: { type: String, required: true, index: true },
  key: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  description: String,
  passengerCapacity: { type: Number, required: true, min: 1 },
  luggageCapacity: { type: Number, min: 0, default: 0 },
  serviceTypes: [{ type: String, enum: ['instant', 'scheduled', 'airport', 'intercity', 'hourly', 'corporate'] }],
  icon: String,
  sortOrder: { type: Number, default: 0 },
  status: { type: String, enum: ['active', 'paused', 'archived'], default: 'active', index: true },
}, { timestamps: true });
vehicleClassSchema.index({ companyId: 1, key: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['active', 'paused'] } } });
module.exports = model('VehicleClass', vehicleClassSchema);

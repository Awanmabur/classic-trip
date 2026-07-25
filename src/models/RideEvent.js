const { Schema, model } = require('./_helpers');
const rideEventSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  companyId: { type: String, required: true, index: true },
  rideId: { type: String, required: true, index: true },
  eventType: { type: String, required: true, index: true },
  actorType: { type: String, enum: ['system', 'customer', 'driver', 'company_staff', 'admin'], required: true },
  actorId: String,
  statusFrom: String,
  statusTo: String,
  location: Schema.Types.Mixed,
  metadata: Schema.Types.Mixed,
  occurredAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true });
rideEventSchema.index({ rideId: 1, occurredAt: 1 });
module.exports = model('RideEvent', rideEventSchema);

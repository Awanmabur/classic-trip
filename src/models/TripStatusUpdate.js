const { Schema, model } = require('./_helpers');

const tripStatusUpdateSchema = new Schema({
  id: { type: String, index: true },
  companyId: { type: String, required: true, index: true },
  scheduleId: { type: String, required: true, index: true },
  vehicleId: { type: String, index: true },
  driverUserId: { type: String, index: true },
  status: { type: String, required: true, index: true },
  location: String,
  note: String,
  passengerCount: Number,
  checkedInCount: Number,
  noShowCount: Number,
  createdBy: String,
}, { timestamps: true });

tripStatusUpdateSchema.index({ companyId: 1, scheduleId: 1, createdAt: -1 });
module.exports = model('TripStatusUpdate', tripStatusUpdateSchema);

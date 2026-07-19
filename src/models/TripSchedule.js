const { Schema, model } = require('./_helpers');

const tripScheduleSchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  routeId: { type: String, required: true, index: true },
  listingId: { type: String, index: true },
  companyId: { type: String, index: true },
  vehicleId: { type: String, index: true },
  vehicleName: String,
  driverName: String,
  departAt: { type: Date, required: true, index: true },
  arriveAt: Date,
  basePrice: Number,
  currency: { type: String, default: 'UGX' },
  totalSeats: Number,
  availableSeats: Number,
  status: { type: String, default: 'active', index: true },
}, { timestamps: true });

module.exports = model('TripSchedule', tripScheduleSchema);

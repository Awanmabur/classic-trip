const { Schema, mediaSchema, model } = require('./_helpers');

const vehicleSeatSchema = new Schema({
  id: String,
  seatNumber: String,
  row: Number,
  col: Number,
  isAisle: { type: Boolean, default: false },
  isDisabled: { type: Boolean, default: false },
  label: String,
  deck: String,
  displayLabel: String,
  seatType: String,
  seatClass: String,
  priceDelta: { type: Number, default: 0 },
  status: String,
  blockedReason: String,
}, { _id: false });

const vehicleSchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  companyId: { type: String, required: true, index: true },
  listingId: { type: String, index: true },
  serviceType: { type: String, default: 'bus', index: true },
  name: { type: String, required: true },
  plateOrCode: String,
  layoutName: { type: String, default: '2x2' },
  rows: Number,
  cols: Number,
  totalSeats: Number,
  seats: [vehicleSeatSchema],
  amenities: [String],
  media: [mediaSchema],
  status: { type: String, enum: ['active', 'maintenance', 'paused', 'archived'], default: 'active', index: true },
  defaultSeatClass: String,
  vipPriceDelta: { type: Number, default: 0 },
  assignedDriverId: String,
  assignedDriverUserId: String,
  assignedDriverName: String,
  maintenanceReason: String,
  updatedBy: String,
}, { timestamps: true });

vehicleSchema.index({ companyId: 1, plateOrCode: 1 });

module.exports = model('Vehicle', vehicleSchema);

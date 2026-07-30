const { Schema, mediaSchema, model } = require('./_helpers');

const vehicleSeatSchema = new Schema({
  id: String,
  seatNumber: String,
  row: Number,
  col: Number,
  side: { type: String, enum: ['left', 'right'] },
  isAisle: { type: Boolean, default: false },
  isDisabled: { type: Boolean, default: false },
  label: String,
  deck: String,
  displayLabel: String,
  seatType: { type: String, enum: ['vip', 'standard', 'disabled'] },
  seatClass: { type: String, enum: ['VIP', 'Standard', 'Disabled'] },
  priceDelta: { type: Number, default: 0 },
  status: { type: String, enum: ['available', 'blocked', 'disabled'] },
  blockedReason: String,
}, { _id: false });

const vehicleRowLayoutSchema = new Schema({
  row: { type: Number, required: true, min: 1, max: 100 },
  leftSeats: { type: Number, required: true, min: 0, max: 6 },
  rightSeats: { type: Number, required: true, min: 0, max: 6 },
}, { _id: false });

const vehicleSchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  companyId: { type: String, required: true, index: true },
  listingId: { type: String, index: true },
  serviceType: { type: String, default: 'bus', index: true, enum: ['bus'] },
  name: { type: String, required: true },
  plateOrCode: String,
  // A bus is sold as one cabin class. VIP is a complete vehicle class, not
  // a handful of individually upgraded seats inside a standard bus.
  vehicleClass: { type: String, enum: ['standard', 'vip'], default: 'standard', index: true },
  layoutName: { type: String, default: '2x2' },
  numberingStartSide: { type: String, enum: ['left', 'right'], default: 'left' },
  driverPosition: { type: String, enum: ['left', 'right'], default: 'right' },
  frontRowPassengerSeats: { type: Number, enum: [0, 1], default: 0 },
  rowLayoutOverrides: [vehicleRowLayoutSchema],
  seatLabelMode: { type: String, enum: ['automatic', 'numeric', 'row_letters', 'prefix_numeric', 'custom', 'preserve'], default: 'automatic' },
  seatLabelPrefix: String,
  rows: Number,
  cols: Number,
  totalSeats: Number,
  activeSeatMapTemplateId: { type: String, index: true },
  activeSeatMapVersionId: { type: String, index: true },
  // Compatibility projection for the existing dashboard. SeatMapVersion is authoritative.
  seatTemplate: [vehicleSeatSchema],
  manufacturer: String,
  modelName: String,
  modelYear: Number,
  chassisNumber: String,
  registrationCountry: String,
  operatorPermitRef: String,
  operatorPermitExpiresAt: Date,
  inspectionRef: String,
  inspectionExpiresAt: Date,
  insuranceRef: String,
  insuranceExpiresAt: Date,
  amenities: [String],
  media: [mediaSchema],
  status: { type: String, enum: ['active', 'maintenance', 'paused', 'archived'], default: 'active', index: true },
  defaultSeatClass: { type: String, enum: ['Standard', 'VIP', 'Disabled'], default: 'Standard' },
  vipPriceDelta: { type: Number, default: 0 },
  assignedDriverId: String,
  assignedDriverUserId: String,
  assignedDriverName: String,
  maintenanceReason: String,
  updatedBy: String,
}, { timestamps: true });

vehicleSchema.index({ companyId: 1, plateOrCode: 1 });
vehicleSchema.index({ companyId: 1, listingId: 1, status: 1, createdAt: -1 });

module.exports = model('Vehicle', vehicleSchema);

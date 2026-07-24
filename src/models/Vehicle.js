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
  seatType: { type: String, enum: ['vip', 'standard', 'disabled'] },
  seatClass: { type: String, enum: ['VIP', 'Standard', 'Disabled'] },
  priceDelta: { type: Number, default: 0 },
  status: { type: String, enum: ['available', 'blocked', 'disabled'] },
  blockedReason: String,
}, { _id: false });

const vehicleSchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  companyId: { type: String, required: true, index: true },
  listingId: { type: String, index: true },
  serviceType: { type: String, default: 'bus', index: true, enum: ['bus'] },
  name: { type: String, required: true },
  plateOrCode: String,
  layoutName: { type: String, default: '2x2' },
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
  defaultSeatClass: { type: String, enum: ['Standard', 'VIP', 'Disabled'] },
  vipPriceDelta: { type: Number, default: 0 },
  assignedDriverId: String,
  assignedDriverUserId: String,
  assignedDriverName: String,
  maintenanceReason: String,
  updatedBy: String,
}, { timestamps: true });

vehicleSchema.index({ companyId: 1, plateOrCode: 1 });

module.exports = model('Vehicle', vehicleSchema);

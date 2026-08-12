const { Schema, model } = require('./_helpers');

const rowLayoutSchema = new Schema({
  row: { type: Number, required: true, min: 1, max: 100 },
  leftSeats: { type: Number, required: true, min: 0, max: 6 },
  rightSeats: { type: Number, required: true, min: 0, max: 6 },
}, { _id: false });

const seatMapTemplateSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  listingId: { type: String, required: true, index: true },
  vehicleId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true },
  vehicleClass: { type: String, enum: ['standard', 'vip'], default: 'standard' },
  layoutName: { type: String, required: true, default: '2x2' },
  numberingStartSide: { type: String, enum: ['left', 'right'], default: 'left' },
  driverPosition: { type: String, enum: ['left', 'right'], default: 'right' },
  frontRowPassengerSeats: { type: Number, enum: [0, 1], default: 0 },
  rowLayoutOverrides: [rowLayoutSchema],
  labelMode: { type: String, enum: ['automatic', 'numeric', 'row_letters', 'prefix_numeric', 'custom', 'preserve'], default: 'automatic' },
  labelPrefix: String,
  rows: { type: Number, required: true, min: 1, max: 100 },
  columns: { type: Number, required: true, min: 1, max: 12 },
  totalSeats: { type: Number, required: true, min: 1, max: 300 },
  activeVersionId: { type: String, index: true },
  versionCounter: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ['draft', 'active', 'archived'], default: 'draft', index: true },
  createdBy: String,
  updatedBy: String,
}, { timestamps: true });

seatMapTemplateSchema.index({ vehicleId: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['draft', 'active'] } } });
seatMapTemplateSchema.index({ companyId: 1, listingId: 1, status: 1 });
module.exports = model('SeatMapTemplate', seatMapTemplateSchema);

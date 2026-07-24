const { Schema, model } = require('./_helpers');

const seatMapTemplateSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  listingId: { type: String, required: true, index: true },
  vehicleId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true },
  layoutName: { type: String, required: true, default: '2x2' },
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

seatMapTemplateSchema.index({ companyId: 1, listingId: 1, status: 1 });
module.exports = model('SeatMapTemplate', seatMapTemplateSchema);

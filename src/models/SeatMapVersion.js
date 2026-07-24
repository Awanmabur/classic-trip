const { Schema, model } = require('./_helpers');

const seatDefinitionSchema = new Schema({
  seatNumber: { type: String, required: true },
  row: { type: Number, required: true, min: 1 },
  column: { type: Number, required: true, min: 1 },
  deck: { type: String, default: 'lower' },
  seatClass: { type: String, enum: ['Standard', 'VIP', 'Accessible', 'Crew'], default: 'Standard' },
  seatType: { type: String, enum: ['window', 'aisle', 'middle', 'accessible', 'crew'], default: 'aisle' },
  priceDelta: { type: Number, default: 0, min: 0 },
  accessible: { type: Boolean, default: false },
  enabled: { type: Boolean, default: true },
  blockedReason: String,
}, { _id: false });

const seatMapVersionSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  templateId: { type: String, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  listingId: { type: String, required: true, index: true },
  vehicleId: { type: String, required: true, index: true },
  version: { type: Number, required: true, min: 1 },
  layoutName: { type: String, required: true },
  labelMode: { type: String, enum: ['automatic', 'numeric', 'row_letters', 'prefix_numeric', 'custom', 'preserve'], default: 'automatic' },
  labelPrefix: String,
  rows: { type: Number, required: true },
  columns: { type: Number, required: true },
  totalSeats: { type: Number, required: true },
  seats: { type: [seatDefinitionSchema], validate: [(rows) => rows.length > 0, 'At least one seat is required'] },
  checksum: { type: String, required: true, index: true },
  status: { type: String, enum: ['draft', 'published', 'retired'], default: 'draft', index: true },
  publishedAt: Date,
  retiredAt: Date,
  createdBy: String,
}, { timestamps: true });

seatMapVersionSchema.index({ templateId: 1, version: 1 }, { unique: true });
seatMapVersionSchema.index({ companyId: 1, vehicleId: 1, status: 1 });
module.exports = model('SeatMapVersion', seatMapVersionSchema);

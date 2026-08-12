const { Schema, mediaSchema, model } = require('./_helpers');
const aircraftSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  companyId: { type: String, required: true, index: true },
  airlineId: { type: String, required: true, index: true },
  aircraftTypeId: { type: String, required: true, index: true },
  registration: { type: String, required: true, uppercase: true, trim: true, index: true },
  name: String,
  seatMapVersionId: { type: String, index: true },
  seatCapacity: { type: Number, required: true, min: 1 },
  cabinClasses: [String],
  images: [mediaSchema],
  airworthinessExpiresAt: Date,
  insuranceExpiresAt: Date,
  status: { type: String, enum: ['draft', 'active', 'maintenance', 'grounded', 'archived'], default: 'draft', index: true },
}, { timestamps: true });
aircraftSchema.index({ companyId: 1, registration: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['draft', 'active', 'maintenance', 'grounded'] } } });
module.exports = model('Aircraft', aircraftSchema);

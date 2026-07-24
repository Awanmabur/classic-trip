const { Schema, model } = require('./_helpers');

const maintenanceBlockSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  listingId: { type: String, required: true, index: true },
  propertyId: { type: String, required: true, index: true },
  roomUnitId: { type: String, required: true, index: true },
  startDate: { type: String, required: true, index: true },
  endDate: { type: String, required: true, index: true },
  reason: { type: String, required: true },
  status: { type: String, enum: ['active', 'completed', 'cancelled'], default: 'active', index: true },
  createdBy: String,
  completedBy: String,
  completedAt: Date,
}, { timestamps: true });
maintenanceBlockSchema.index({ companyId: 1, roomUnitId: 1, startDate: 1, endDate: 1 });
module.exports = model('MaintenanceBlock', maintenanceBlockSchema);

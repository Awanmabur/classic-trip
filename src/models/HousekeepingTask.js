const { Schema, model } = require('./_helpers');

const housekeepingTaskSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  listingId: { type: String, required: true, index: true },
  propertyId: { type: String, required: true, index: true },
  roomUnitId: { type: String, required: true, index: true },
  bookingRef: { type: String, index: true },
  assignmentId: { type: String, index: true },
  targetDate: { type: String, index: true },
  nightIds: [{ type: String, index: true }],
  taskType: { type: String, enum: ['checkout_clean', 'stayover_clean', 'inspection', 'maintenance_followup', 'manual'], default: 'manual' },
  status: { type: String, enum: ['open', 'in_progress', 'blocked', 'completed', 'cancelled'], default: 'open', index: true },
  priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
  assignedTo: { type: String, index: true },
  dueAt: Date,
  startedAt: Date,
  completedAt: Date,
  notes: String,
  createdBy: String,
  updatedBy: String,
}, { timestamps: true });
housekeepingTaskSchema.index({ companyId: 1, roomUnitId: 1, status: 1 });
housekeepingTaskSchema.index({ companyId: 1, propertyId: 1, targetDate: 1, status: 1 });
module.exports = model('HousekeepingTask', housekeepingTaskSchema);

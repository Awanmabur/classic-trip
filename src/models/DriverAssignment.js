const { Schema, model } = require('./_helpers');

const driverAssignmentSchema = new Schema({
  id: { type: String, index: true },
  companyId: { type: String, required: true, index: true },
  employeeId: { type: String, required: true, index: true },
  driverUserId: { type: String, index: true },
  vehicleId: { type: String, index: true },
  scheduleId: { type: String, index: true },
  routeId: String,
  listingId: String,
  assignmentType: { type: String, default: 'schedule', index: true },
  startsAt: Date,
  endsAt: Date,
  safetyStatus: String,
  status: { type: String, default: 'active', index: true },
  note: String,
  assignedBy: String,
}, { timestamps: true });

driverAssignmentSchema.index({ companyId: 1, employeeId: 1, scheduleId: 1 });

module.exports = model('DriverAssignment', driverAssignmentSchema);

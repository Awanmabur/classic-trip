const { Schema, model } = require('./_helpers');

const driverAssignmentSchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  companyId: { type: String, required: true, index: true },
  employeeId: { type: String, required: true, index: true },
  driverUserId: { type: String, index: true },
  vehicleId: { type: String, index: true },
  scheduleId: { type: String, index: true },
  routeId: String,
  listingId: String,
  assignmentType: { type: String, default: 'schedule', index: true, enum: ['schedule', 'vehicle'] },
  assignmentRole: { type: String, enum: ['driver', 'co_driver', 'conductor', 'attendant', 'dispatcher'], default: 'driver', index: true },
  startsAt: Date,
  endsAt: Date,
  // safetyStatus/status intentionally left unconstrained: both accept free-form
  // payload.status/payload.safetyStatus with no dashboard select or established vocabulary
  // behind them (same class as TripSchedule.tripStatus and TripStatusUpdate.status).
  safetyStatus: String,
  status: { type: String, default: 'active', index: true },
  note: String,
  assignedBy: String,
}, { timestamps: true });

driverAssignmentSchema.index({ companyId: 1, employeeId: 1, scheduleId: 1 });

module.exports = model('DriverAssignment', driverAssignmentSchema);

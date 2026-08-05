const { Schema, model } = require('./_helpers');

const tripScheduleSchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  routeId: { type: String, required: true, index: true },
  listingId: { type: String, index: true },
  companyId: { type: String, index: true },
  vehicleId: { type: String, index: true },
  vehicleName: String,
  vehicleClass: { type: String, enum: ['standard', 'vip'], default: 'standard', index: true },
  routeVersion: { type: Number, default: 1 },
  originStopId: { type: String, index: true },
  destinationStopId: { type: String, index: true },
  seatMapTemplateId: { type: String, index: true },
  seatMapVersionId: { type: String, index: true },
  fareProductId: { type: String, index: true },
  routeSnapshot: Schema.Types.Mixed,
  seatMapSnapshot: Schema.Types.Mixed,
  fareSnapshot: Schema.Types.Mixed,
  inventoryReadyAt: Date,
  driverName: String,
  departAt: { type: Date, required: true, index: true },
  arriveAt: Date,
  basePrice: Number,
  currency: { type: String, required: true, uppercase: true, trim: true },
  totalSeats: Number,
  availableSeats: Number,
  status: { type: String, default: 'active', index: true, enum: ['draft', 'active', 'published', 'boarding', 'departed', 'arrived', 'completed', 'delayed', 'cancelled', 'archived'] },
  driverIds: [String],
  boardingStartAt: Date,
  fareClass: { type: String, enum: ['standard', 'economy', 'business', 'executive', 'vip', 'premium', 'express'] },
  gate: String,
  platform: String,
  notes: String,
  seatInventorySnapshot: [Schema.Types.Mixed],
  publishValidation: Schema.Types.Mixed,
  statusReason: String,
  driverEmployeeId: String,
  driverUserId: String,
  assignmentStatus: String,
  publishedAt: Date,
  completedAt: Date,
  tripStatus: String,
  tripStatusLocation: String,
  tripStatusNote: String,
  tripStatusUpdatedAt: Date,
  scheduleRuleId: { type: String, index: true },
}, { timestamps: true });

tripScheduleSchema.index({ status: 1, departAt: 1 });
tripScheduleSchema.index({ companyId: 1, listingId: 1, status: 1, departAt: 1 });
tripScheduleSchema.index({ companyId: 1, vehicleId: 1, status: 1, departAt: 1, arriveAt: 1 });
tripScheduleSchema.index(
  { scheduleRuleId: 1, departAt: 1 },
  { unique: true, partialFilterExpression: { scheduleRuleId: { $gt: '' } } },
);
tripScheduleSchema.index({ companyId: 1, createdAt: -1 });
module.exports = model('TripSchedule', tripScheduleSchema);

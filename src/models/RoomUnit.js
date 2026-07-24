const { Schema, mediaSchema, model } = require('./_helpers');

const roomUnitSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  listingId: { type: String, required: true, index: true },
  propertyId: { type: String, required: true, index: true },
  roomTypeId: { type: String, required: true, index: true },
  unitNumber: { type: String, required: true, index: true },
  normalizedUnitNumber: { type: String, required: true },
  floor: String,
  wing: String,
  viewType: String,
  accessible: { type: Boolean, default: false },
  smokingAllowed: { type: Boolean, default: false },
  connectingRoom: { type: Boolean, default: false },
  status: { type: String, default: 'available', index: true, enum: ['available', 'occupied', 'maintenance', 'cleaning', 'reserved', 'archived'] },
  housekeepingStatus: { type: String, default: 'clean', enum: ['clean', 'dirty', 'cleaning', 'inspected', 'maintenance', 'occupied', 'ready'] },
  notes: String,
  housekeepingTaskStatus: { type: String, enum: ['open', 'in_progress', 'closed', 'blocked', ''], default: '' },
  housekeepingPriority: { type: String, enum: ['low', 'normal', 'high', 'urgent', ''], default: '' },
  housekeepingAssignedTo: String,
  housekeepingDueAt: Date,
  lastGuestBookingRef: { type: String, index: true },
  createdBy: String,
  updatedBy: String,
  media: [mediaSchema],
  documents: [mediaSchema],
}, { timestamps: true });
roomUnitSchema.index({ companyId: 1, propertyId: 1, normalizedUnitNumber: 1 }, { unique: true });
module.exports = model('RoomUnit', roomUnitSchema);

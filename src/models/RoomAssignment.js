const { Schema, moneySchema, model } = require('./_helpers');

const roomAssignmentSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  reservationId: { type: String, required: true, index: true },
  bookingItemId: { type: String, required: true, index: true },
  bookingId: { type: String, required: true, index: true },
  bookingRef: { type: String, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  listingId: { type: String, required: true, index: true },
  propertyId: { type: String, required: true, index: true },
  roomTypeId: { type: String, required: true, index: true },
  roomUnitId: { type: String, required: true, index: true },
  roomNumberSnapshot: String,
  roomTypeSnapshot: String,
  ratePlanId: { type: String, index: true },
  ratePlanSnapshot: Schema.Types.Mixed,
  checkInDate: { type: String, required: true, index: true },
  checkOutDate: { type: String, required: true, index: true },
  nightIds: [{ type: String, index: true }],
  guestIds: [{ type: String, index: true }],
  pricing: moneySchema,
  status: { type: String, enum: ['awaiting_payment', 'assigned', 'occupied', 'checked_out', 'completed', 'cancelled', 'no_show', 'refunded', 'expired'], default: 'awaiting_payment', index: true },
  assignedAt: Date,
  releasedAt: Date,
}, { timestamps: true });
roomAssignmentSchema.index({ companyId: 1, roomUnitId: 1, checkInDate: 1, checkOutDate: 1 });
roomAssignmentSchema.index({ reservationId: 1, roomUnitId: 1 }, { unique: true });
module.exports = model('RoomAssignment', roomAssignmentSchema);

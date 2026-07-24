const { Schema, model } = require('./_helpers');
const { ROOM_NIGHT_STATUSES, ROOM_CHECK_IN_STATUSES } = require('../domain/statuses');

const roomNightInventorySchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  listingId: { type: String, required: true, index: true },
  propertyId: { type: String, required: true, index: true },
  roomTypeId: { type: String, required: true, index: true },
  roomUnitId: { type: String, required: true, index: true },
  ratePlanId: { type: String, index: true },
  date: { type: String, required: true, index: true },
  price: { type: Number, required: true, min: 0 },
  availableInventory: { type: Number, default: 1, min: 0, max: 1 },
  status: { type: String, default: 'available', index: true, enum: ROOM_NIGHT_STATUSES },
  closedToArrival: { type: Boolean, default: false },
  closedToDeparture: { type: Boolean, default: false },
  minStay: { type: Number, default: 1, min: 1 },
  maxStay: { type: Number, default: 90, min: 1 },
  holdId: String,
  bookingRef: { type: String, index: true },
  reservationId: { type: String, index: true },
  assignmentId: { type: String, index: true },
  guestName: String,
  checkInStatus: { type: String, enum: ROOM_CHECK_IN_STATUSES },
  notes: String,
  housekeepingStatus: String,
  createdBy: String,
  updatedBy: String,
}, { timestamps: true });
roomNightInventorySchema.index({ roomUnitId: 1, date: 1 }, { unique: true });
module.exports = model('RoomNightInventory', roomNightInventorySchema);

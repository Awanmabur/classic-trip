const { Schema, model } = require('./_helpers');

const busSeatAssignmentSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  reservationId: { type: String, required: true, index: true },
  bookingItemId: { type: String, required: true, index: true },
  bookingId: { type: String, required: true, index: true },
  bookingRef: { type: String, required: true, index: true },
  passengerId: { type: String, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  scheduleId: { type: String, required: true, index: true },
  seatNumber: { type: String, required: true, index: true },
  originStopId: { type: String, required: true, index: true },
  destinationStopId: { type: String, required: true, index: true },
  segmentIds: [{ type: String, required: true }],
  status: { type: String, enum: ['held', 'confirmed', 'checked_in', 'no_show', 'cancelled', 'refunded'], default: 'held', index: true },
}, { timestamps: true });

busSeatAssignmentSchema.index({ scheduleId: 1, seatNumber: 1, reservationId: 1 }, { unique: true });
module.exports = model('BusSeatAssignment', busSeatAssignmentSchema);

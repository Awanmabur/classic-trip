const { Schema, model } = require('./_helpers');

const busSeatSegmentInventorySchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  listingId: { type: String, required: true, index: true },
  routeId: { type: String, required: true, index: true },
  scheduleId: { type: String, required: true, index: true },
  vehicleId: { type: String, required: true, index: true },
  seatMapVersionId: { type: String, required: true, index: true },
  seatNumber: { type: String, required: true, index: true },
  seatClass: String,
  priceDelta: { type: Number, default: 0, min: 0 },
  segmentId: { type: String, required: true, index: true },
  segmentOrder: { type: Number, required: true, min: 0 },
  fromStopId: { type: String, required: true, index: true },
  toStopId: { type: String, required: true, index: true },
  status: {
    type: String,
    enum: ['available', 'held', 'booked', 'blocked', 'disabled', 'checked_in', 'no_show', 'cancelled', 'refunded'],
    default: 'available',
    index: true,
  },
  holdId: { type: String, index: true },
  lockedUntil: { type: Date, index: true },
  bookingId: { type: String, index: true },
  bookingItemId: { type: String, index: true },
  reservationId: { type: String, index: true },
  ticketId: { type: String, index: true },
  passengerId: { type: String, index: true },
  blockedReason: String,
}, { timestamps: true });

busSeatSegmentInventorySchema.index({ scheduleId: 1, seatNumber: 1, segmentId: 1 }, { unique: true });
busSeatSegmentInventorySchema.index({ scheduleId: 1, segmentOrder: 1, status: 1 });
busSeatSegmentInventorySchema.index({ holdId: 1, status: 1 });
module.exports = model('BusSeatSegmentInventory', busSeatSegmentInventorySchema);

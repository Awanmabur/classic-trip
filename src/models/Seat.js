const { Schema, model } = require('./_helpers');

// Canonical operational seat states persisted in MongoDB.
const SEAT_STATUSES = [
  'available', 'selected', 'locked', 'held', 'taken', 'booked',
  'checked_in', 'no_show', 'cancelled', 'refunded', 'blocked',
  'maintenance', 'reserved', 'disabled',
];

const seatSchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  scheduleId: { type: String, required: true, index: true },
  companyId: { type: String, index: true },
  listingId: { type: String, index: true },
  routeId: { type: String, index: true },
  vehicleId: { type: String, index: true },
  seatMapVersionId: { type: String, index: true },
  source: { type: String, enum: ['seat_map_projection'], default: 'seat_map_projection' },
  seatNumber: { type: String, required: true },
  seatClass: String,
  seatType: String,
  priceDelta: { type: Number, default: 0 },
  status: { type: String, enum: SEAT_STATUSES, default: 'available', index: true },
  blockedReason: String,
  lockedUntil: Date,
  lockId: String,
  bookingRef: { type: String, index: true },
  bookingId: { type: String, index: true },
  passengerName: String,
  passengerPhone: String,
  passengerEmail: String,
}, { timestamps: true });

seatSchema.index({ scheduleId: 1, seatNumber: 1 }, { unique: true });
module.exports = model('Seat', seatSchema);

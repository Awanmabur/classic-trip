const { Schema, model } = require('./_helpers');

// Status is the full operational vocabulary the app actually uses (see companyService.js's
// updateSeatStatus allowedStatuses) - not just the 4-value subset this previously declared.
// Anything outside the enum was silently failing Mongoose validation on every write, leaving
// the in-memory seat status permanently out of sync with what's actually saved in the database.
const SEAT_STATUSES = [
  'available', 'selected', 'locked', 'held', 'taken', 'booked',
  'checked-in', 'no-show', 'cancelled', 'refunded', 'blocked',
  'maintenance', 'reserved', 'disabled',
];

const seatSchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  scheduleId: { type: String, required: true, index: true },
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

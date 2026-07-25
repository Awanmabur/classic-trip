const { Schema, model } = require('./_helpers');

const flightSeatSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  listingId: { type: String, required: true, index: true },
  departureId: { type: String, required: true, index: true },
  seatNumber: { type: String, required: true, uppercase: true, trim: true },
  rowNumber: Number,
  columnCode: String,
  cabinClass: { type: String, enum: ['economy', 'premium_economy', 'business', 'first'], default: 'economy' },
  seatType: { type: String, enum: ['window', 'middle', 'aisle', 'standard', 'extra_legroom'], default: 'standard' },
  priceDelta: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ['available', 'held', 'booked', 'blocked'], default: 'available', index: true },
  bookingRef: { type: String, index: true },
  passengerName: String,
  holdId: { type: String, index: true },
  holdExpiresAt: Date,
}, { timestamps: true });

flightSeatSchema.index({ departureId: 1, seatNumber: 1 }, { unique: true });
flightSeatSchema.index({ departureId: 1, status: 1 });
module.exports = model('FlightSeat', flightSeatSchema);

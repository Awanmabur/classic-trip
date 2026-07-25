const { Schema, model } = require('./_helpers');
const flightSeatInventorySchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  companyId: { type: String, required: true, index: true },
  departureId: { type: String, required: true, index: true },
  listingId: { type: String, required: true, index: true },
  aircraftId: { type: String, required: true, index: true },
  seatMapVersionId: { type: String, required: true, index: true },
  seatNumber: { type: String, required: true },
  cabinClass: { type: String, required: true, index: true },
  seatType: String,
  fareFamilyIds: [{ type: String, index: true }],
  status: { type: String, enum: ['available', 'held', 'booked', 'blocked', 'checked_in', 'boarded', 'cancelled'], default: 'available', index: true },
  holdId: { type: String, index: true },
  heldUntil: Date,
  orderId: { type: String, index: true },
  travelerId: { type: String, index: true },
  ticketId: { type: String, index: true },
  version: { type: Number, default: 0 },
}, { timestamps: true });
flightSeatInventorySchema.index({ departureId: 1, seatNumber: 1 }, { unique: true });
flightSeatInventorySchema.index({ companyId: 1, departureId: 1, cabinClass: 1, status: 1 });
module.exports = model('FlightSeatInventory', flightSeatInventorySchema);

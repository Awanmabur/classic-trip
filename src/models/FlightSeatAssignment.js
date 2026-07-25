const { Schema, model } = require('./_helpers');
const flightSeatAssignmentSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  companyId: { type: String, required: true, index: true },
  orderId: { type: String, required: true, index: true },
  travelerId: { type: String, required: true, index: true },
  departureId: { type: String, required: true, index: true },
  inventoryId: { type: String, required: true, index: true },
  seatNumber: { type: String, required: true },
  cabinClass: String,
  chargeAmount: { type: Number, min: 0, default: 0 },
  currency: { type: String, uppercase: true, trim: true },
  status: { type: String, enum: ['held', 'confirmed', 'checked_in', 'boarded', 'cancelled'], default: 'held', index: true },
}, { timestamps: true });
flightSeatAssignmentSchema.index({ departureId: 1, seatNumber: 1, status: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['held', 'confirmed', 'checked_in', 'boarded'] } } });
module.exports = model('FlightSeatAssignment', flightSeatAssignmentSchema);

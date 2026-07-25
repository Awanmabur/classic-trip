const { Schema, model } = require('./_helpers');
const couponSchema = new Schema({
  departureId: String,
  flightNumber: String,
  originAirportId: String,
  destinationAirportId: String,
  seatNumber: String,
  status: { type: String, enum: ['open', 'checked_in', 'boarded', 'flown', 'voided', 'refunded', 'no_show'], default: 'open' },
}, { _id: false });
const flightTicketSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  ticketNumber: { type: String, required: true, unique: true, index: true },
  orderId: { type: String, required: true, index: true },
  bookingId: { type: String, required: true, index: true },
  bookingRef: { type: String, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  agentCompanyId: { type: String, index: true },
  supplierId: { type: String, index: true },
  travelerId: { type: String, required: true, index: true },
  passengerName: String,
  supplierTicketNumber: String,
  coupons: [couponSchema],
  qrTokenHash: { type: String, unique: true, sparse: true, index: true },
  status: { type: String, enum: ['pending', 'issued', 'checked_in', 'partially_used', 'used', 'voided', 'refunded'], default: 'pending', index: true },
  issuedAt: Date,
  voidedAt: Date,
}, { timestamps: true });
flightTicketSchema.index({ companyId: 1, bookingRef: 1 });
module.exports = model('FlightTicket', flightTicketSchema);

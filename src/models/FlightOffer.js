const { Schema, model } = require('./_helpers');

const flightOfferSchema = new Schema({
  id: { type: String, index: true }, airlineId: String, airlineName: String, offerRef: { type: String, index: true },
  originAirport: String, destinationAirport: String, currency: String, totalPrice: Number,
  segments: [{ segmentId: String, flightNumber: String, departAirport: String, arriveAirport: String, departAt: Date, arriveAt: Date, cabin: String }],
  baggage: [{ passengerType: String, allowance: String, price: Number }], ancillaries: [{ code: String, name: String, price: Number }],
  pnr: String, passengers: [{ fullName: String, documentNumber: String, nationality: String }], paymentId: String, ticketNumbers: [String], refundStatus: String,
  notifications: [String], supportTicketIds: [String], status: { type: String, default: 'teaser' },
}, { timestamps: true });
module.exports = model('FlightOffer', flightOfferSchema);

const { Schema, model } = require('./_helpers');
const flightDepartureSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  companyId: { type: String, required: true, index: true },
  airlineId: { type: String, required: true, index: true },
  listingId: { type: String, required: true, index: true },
  routeId: { type: String, required: true, index: true },
  supplierId: { type: String, index: true },
  flightNumber: { type: String, required: true, uppercase: true, trim: true, index: true },
  aircraftId: { type: String, required: true, index: true },
  seatMapVersionId: { type: String, required: true, index: true },
  originAirportId: { type: String, required: true, index: true },
  destinationAirportId: { type: String, required: true, index: true },
  departureTerminal: String,
  arrivalTerminal: String,
  departAt: { type: Date, required: true, index: true },
  arriveAt: { type: Date, required: true, index: true },
  localDeparture: Schema.Types.Mixed,
  localArrival: Schema.Types.Mixed,
  gate: String,
  checkInOpensAt: Date,
  checkInClosesAt: Date,
  boardingStartsAt: Date,
  boardingClosesAt: Date,
  inventoryGeneratedAt: Date,
  publicationStatus: { type: String, enum: ['draft', 'published', 'paused', 'cancelled', 'completed'], default: 'draft', index: true },
  operationalStatus: { type: String, enum: ['scheduled', 'check_in_open', 'boarding', 'departed', 'arrived', 'delayed', 'cancelled', 'completed'], default: 'scheduled', index: true },
  delayMinutes: { type: Number, min: 0, default: 0 },
  statusNote: String,
}, { timestamps: true });
flightDepartureSchema.index({ companyId: 1, flightNumber: 1, departAt: 1 }, { unique: true });
flightDepartureSchema.index({ originAirportId: 1, destinationAirportId: 1, departAt: 1, publicationStatus: 1 });
module.exports = model('FlightDeparture', flightDepartureSchema);

'use strict';

const { Schema, model } = require('./_helpers');

const inventorySchema = new Schema({
  cabinClass: { type: String, enum: ['economy', 'premium_economy', 'business', 'first'], required: true },
  totalSeats: { type: Number, required: true, min: 0 },
  heldSeats: { type: Number, default: 0, min: 0 },
  bookedSeats: { type: Number, default: 0, min: 0 },
}, { _id: false });

const flightScheduleSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  companyId: { type: String, required: true, index: true },
  listingId: { type: String, required: true, index: true },
  aircraftId: { type: String, required: true, index: true },
  flightNumber: { type: String, required: true, trim: true, uppercase: true, index: true },
  originAirportId: { type: String, required: true, index: true },
  destinationAirportId: { type: String, required: true, index: true },
  departureAt: { type: Date, required: true, index: true },
  arrivalAt: { type: Date, required: true, index: true },
  originTimezone: { type: String, required: true },
  destinationTimezone: { type: String, required: true },
  terminal: String,
  gate: String,
  fareIds: [{ type: String, index: true }],
  inventory: [inventorySchema],
  seatState: { type: Map, of: String, default: {} },
  supplierType: { type: String, enum: ['native', 'airline_api', 'ndc', 'gds', 'consolidator'], default: 'native' },
  supplierReference: { type: String, index: true },
  status: { type: String, enum: ['draft', 'published', 'boarding', 'departed', 'arrived', 'delayed', 'cancelled'], default: 'draft', index: true },
  delayMinutes: { type: Number, default: 0, min: 0 },
  notes: String,
}, { timestamps: true, optimisticConcurrency: true });

flightScheduleSchema.index({ companyId: 1, flightNumber: 1, departureAt: 1 }, { unique: true });
flightScheduleSchema.index({ originAirportId: 1, destinationAirportId: 1, departureAt: 1, status: 1 });
module.exports = model('FlightSchedule', flightScheduleSchema);

const { Schema, model } = require('./_helpers');
const flightRouteSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  companyId: { type: String, required: true, index: true },
  airlineId: { type: String, required: true, index: true },
  listingId: { type: String, required: true, index: true },
  originAirportId: { type: String, required: true, index: true },
  destinationAirportId: { type: String, required: true, index: true },
  flightNumberPrefix: { type: String, uppercase: true, trim: true },
  defaultDurationMinutes: { type: Number, min: 1 },
  international: { type: Boolean, default: false },
  status: { type: String, enum: ['draft', 'active', 'paused', 'archived'], default: 'draft', index: true },
}, { timestamps: true });
flightRouteSchema.index({ companyId: 1, originAirportId: 1, destinationAirportId: 1, listingId: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['draft', 'active', 'paused'] } } });
module.exports = model('FlightRoute', flightRouteSchema);

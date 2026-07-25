const { Schema, model } = require('./_helpers');
const flightTravelerSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  orderId: { type: String, required: true, index: true },
  bookingId: { type: String, required: true, index: true },
  bookingRef: { type: String, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  agentCompanyId: { type: String, index: true },
  passengerType: { type: String, enum: ['adult', 'child', 'infant'], default: 'adult' },
  title: String,
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  dateOfBirth: { type: Date, required: true },
  sex: String,
  nationality: String,
  documentType: { type: String, enum: ['passport', 'national_id', 'travel_document'] },
  documentNumberEncrypted: String,
  documentNumberLast4: String,
  documentExpiry: Date,
  documentIssuingCountry: String,
  frequentFlyerNumber: String,
  specialAssistance: [String],
  status: { type: String, enum: ['pending', 'confirmed', 'checked_in', 'boarded', 'no_show', 'cancelled'], default: 'pending', index: true },
}, { timestamps: true });
flightTravelerSchema.index({ orderId: 1, firstName: 1, lastName: 1 });
module.exports = model('FlightTraveler', flightTravelerSchema);

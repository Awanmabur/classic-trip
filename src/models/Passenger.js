const { Schema, model } = require('./_helpers');

const passengerSchema = new Schema({
  id: { type: String, index: true },
  bookingId: { type: String, required: true, index: true },
  fullName: String,
  phone: String,
  email: String,
  seatOrRoom: String,
  seatNumber: String,
  pickupPoint: String,
  dropoffPoint: String,
  specialNotes: String,
  travelNotes: String,
  identityNumber: String,
  identityType: String,
  dateOfBirth: Date,
  sex: String,
  nationality: String,
  emergencyContactName: String,
  emergencyContactPhone: String,
  luggageCount: { type: Number, default: 0, min: 0 },
  bookingRef: { type: String, index: true },
  companyId: { type: String, index: true },
  listingId: { type: String, index: true },
  scheduleId: { type: String, index: true },
  passengerIndex: Number,
}, { timestamps: true });

passengerSchema.index({ bookingRef: 1, passengerIndex: 1 }, { unique: true, sparse: true });
passengerSchema.index({ companyId: 1, scheduleId: 1 });

module.exports = model('Passenger', passengerSchema);

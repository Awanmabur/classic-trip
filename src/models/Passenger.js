const { Schema, model } = require('./_helpers');

const passengerSchema = new Schema({
  id: { type: String, index: true },
  bookingId: { type: String, required: true, index: true },
  fullName: String,
  phone: String,
  email: String,
  seatOrRoom: String,
  identityNumber: String,
}, { timestamps: true });

module.exports = model('Passenger', passengerSchema);

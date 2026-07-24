const { Schema, model } = require('./_helpers');

const hotelGuestSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  reservationId: { type: String, required: true, index: true },
  bookingId: { type: String, required: true, index: true },
  bookingRef: { type: String, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  listingId: { type: String, required: true, index: true },
  roomAssignmentId: { type: String, index: true },
  roomIndex: { type: Number, default: 0, min: 0, index: true },
  guestType: { type: String, enum: ['adult', 'child', 'infant'], default: 'adult' },
  guestIndex: { type: Number, required: true, min: 0 },
  isLeadGuest: { type: Boolean, default: false },
  fullName: { type: String, required: true },
  email: String,
  phone: String,
  identityType: String,
  identityNumber: String,
  nationality: String,
  dateOfBirth: Date,
  sex: String,
  emergencyContactName: String,
  emergencyContactPhone: String,
  specialRequests: String,
  checkInStatus: { type: String, enum: ['not_checked', 'checked_in', 'checked_out', 'no_show'], default: 'not_checked', index: true },
  checkedInAt: Date,
  checkedOutAt: Date,
}, { timestamps: true });
hotelGuestSchema.index({ bookingRef: 1, guestIndex: 1 }, { unique: true });
hotelGuestSchema.index({ reservationId: 1, roomIndex: 1, checkInStatus: 1 });
module.exports = model('HotelGuest', hotelGuestSchema);

const { Schema, model } = require('./_helpers');

const busTicketSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  ticketNumber: { type: String, unique: true, required: true, index: true },
  bookingId: { type: String, required: true, index: true },
  bookingRef: { type: String, required: true, index: true },
  bookingItemId: { type: String, required: true, index: true },
  reservationId: { type: String, required: true, index: true },
  seatAssignmentId: { type: String, required: true, unique: true, index: true },
  passengerId: { type: String, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  listingId: { type: String, required: true, index: true },
  routeId: { type: String, required: true, index: true },
  scheduleId: { type: String, required: true, index: true },
  seatNumber: { type: String, required: true },
  originStopId: { type: String, required: true },
  destinationStopId: { type: String, required: true },
  qrTokenHash: { type: String, unique: true, sparse: true, index: true },
  qrTokenPreview: String,
  status: { type: String, enum: ['pending_payment', 'valid', 'used', 'cancelled', 'refunded', 'voided'], default: 'pending_payment', index: true },
  checkInStatus: { type: String, enum: ['not_checked', 'boarding', 'checked_in', 'no_show', 'cancelled'], default: 'not_checked', index: true },
  issuedAt: Date,
  usedAt: Date,
  checkedInAt: Date,
  checkedInBy: String,
  noShowAt: Date,
  cancelledAt: Date,
}, { timestamps: true });

busTicketSchema.index({ companyId: 1, scheduleId: 1, checkInStatus: 1 });
module.exports = model('BusTicket', busTicketSchema);

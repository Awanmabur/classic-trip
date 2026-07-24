const { Schema, moneySchema, model } = require('./_helpers');

const hotelReservationSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  bookingId: { type: String, required: true, index: true },
  bookingRef: { type: String, required: true, unique: true, index: true },
  bookingItemIds: [{ type: String, index: true }],
  companyId: { type: String, required: true, index: true },
  listingId: { type: String, required: true, index: true },
  propertyId: { type: String, required: true, index: true },
  customerUserId: { type: String, index: true },
  leadGuestId: { type: String, index: true },
  checkInDate: { type: String, required: true, index: true },
  checkOutDate: { type: String, required: true, index: true },
  actualCheckInAt: Date,
  actualCheckOutAt: Date,
  roomCount: { type: Number, required: true, min: 1 },
  adults: { type: Number, required: true, min: 1 },
  children: { type: Number, default: 0, min: 0 },
  infants: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ['awaiting_payment', 'confirmed', 'checked_in', 'checked_out', 'completed', 'cancelled', 'no_show', 'refunded', 'expired', 'failed'], default: 'awaiting_payment', index: true },
  paymentStatus: { type: String, enum: ['pending', 'successful', 'failed', 'expired', 'refunded'], default: 'pending', index: true },
  refundStatus: { type: String, enum: ['none', 'requested', 'partially_refunded', 'refunded', 'rejected'], default: 'none', index: true },
  refundedAmount: { type: Number, default: 0, min: 0 },
  refundIds: [{ type: String, index: true }],
  settlementStatus: { type: String, enum: ['pending_payment', 'pending_fulfillment', 'eligible', 'settled', 'reconciliation_required', 'refunded'], default: 'pending_payment', index: true },
  pricing: moneySchema,
  priceSnapshot: Schema.Types.Mixed,
  policySnapshot: Schema.Types.Mixed,
  estimatedArrivalTime: String,
  arrivalNotes: String,
  departureNotes: String,
  specialRequests: String,
  source: { type: String, enum: ['web', 'mobile', 'company_manual', 'agent_offline', 'admin_manual'], default: 'web' },
  checkedInBy: String,
  checkedOutBy: String,
  cancelledAt: Date,
  cancellationReason: String,
}, { timestamps: true });
hotelReservationSchema.index({ companyId: 1, checkInDate: 1, status: 1 });
hotelReservationSchema.index({ companyId: 1, checkOutDate: 1, status: 1 });
hotelReservationSchema.index({ companyId: 1, propertyId: 1, status: 1, checkInDate: 1, checkOutDate: 1 });
module.exports = model('HotelReservation', hotelReservationSchema);

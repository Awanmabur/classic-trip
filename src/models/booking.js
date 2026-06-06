const { Schema, moneySchema, model } = require('./_helpers');

const bookingSchema = new Schema({
  id: { type: String, index: true },
  bookingRef: { type: String, unique: true, required: true, index: true },
  guestLookupCode: { type: String, index: true },
  serviceType: { type: String, required: true, index: true },
  guestSnapshot: Schema.Types.Mixed,
  customerUserId: { type: String, index: true },
  companyId: { type: String, index: true },
  tenantId: { type: String, index: true },
  tenantSlug: { type: String, index: true },
  listingId: { type: String, index: true },
  catalogId: { type: String, index: true },
  scheduleId: { type: String, index: true },
  tripId: { type: String, index: true },
  vehicleId: { type: String, index: true },
  passengers: [Schema.Types.Mixed],
  addons: [Schema.Types.Mixed],
  quantity: { type: Number, default: 1 },
  pricing: moneySchema,
  grossAmount: Number,
  walletUsed: { type: Number, default: 0 },
  promoterAttribution: Schema.Types.Mixed,
  referralCode: { type: String, index: true },
  risk: Schema.Types.Mixed,
  paymentStatus: { type: String, default: 'pending', index: true },
  paymentProvider: String,
  paymentRef: { type: String, index: true },
  paymentMethodNote: String,
  bookingStatus: { type: String, default: 'draft', index: true },
  settlementStatus: { type: String, default: 'pending', index: true },
  qrCodeValue: { type: String, index: true },
  ticketPdf: Schema.Types.Mixed,
  lockedUntil: Date,
  checkInStatus: { type: String, default: 'not_checked', index: true },
  checkedInAt: Date,
  checkedInBy: String,
  checkedInByUserId: { type: String, index: true },
  checkInNote: String,
  noShowAt: Date,
  noShowBy: String,
  noShowByUserId: { type: String, index: true },
  cancelReason: String,
  cancellationReason: String,
  cancelledAt: Date,
  completedAt: Date,
  earningsReleasedAt: Date,
  customerNote: String,
  notes: String,
  auditTrail: [Schema.Types.Mixed],
}, { timestamps: true });

bookingSchema.index({ bookingRef: 1, 'guestSnapshot.phone': 1 });
bookingSchema.index({ companyId: 1, bookingStatus: 1, paymentStatus: 1 });
bookingSchema.index({ companyId: 1, guestLookupCode: 1 });
bookingSchema.index({ companyId: 1, paymentRef: 1 });
bookingSchema.index({ customerUserId: 1, createdAt: -1 });
bookingSchema.index({ referralCode: 1, createdAt: -1 });
module.exports = model('Booking', bookingSchema);

const { Schema, moneySchema, model } = require('./_helpers');

const bookingItemSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  bookingId: { type: String, required: true, index: true },
  bookingRef: { type: String, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  agentCompanyId: { type: String, index: true },
  providerCompanyId: { type: String, index: true },
  supplierId: { type: String, index: true },
  listingId: { type: String, required: true, index: true },
  serviceType: { type: String, required: true, enum: ['bus', 'hotel', 'flight', 'local_transport', 'tour', 'car_rental', 'cargo'], index: true },
  domainReservationId: { type: String, index: true },
  quantity: { type: Number, default: 1, min: 1 },
  pricing: moneySchema,
  priceSnapshot: Schema.Types.Mixed,
  policySnapshot: Schema.Types.Mixed,
  status: {
    type: String,
    enum: ['draft', 'holding_inventory', 'awaiting_payment', 'confirmed', 'in_progress', 'completed', 'cancellation_pending', 'cancelled', 'no_show', 'refunded', 'expired', 'failed', 'disputed'],
    default: 'draft',
    index: true,
  },
}, { timestamps: true });

bookingItemSchema.index({ bookingId: 1, serviceType: 1 });
bookingItemSchema.index({ agentCompanyId: 1, serviceType: 1, createdAt: -1 });
bookingItemSchema.index({ providerCompanyId: 1, serviceType: 1, createdAt: -1 });
module.exports = model('BookingItem', bookingItemSchema);

const { Schema, moneySchema, model } = require('./_helpers');

const cartSchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  cartRef: { type: String, unique: true, required: true, index: true },
  status: { type: String, default: 'draft', index: true, enum: ['draft', 'validated', 'inventory_failed', 'validation_failed', 'payment_failed', 'checked_out', 'payment_pending'] },
  userId: { type: String, index: true },
  guestKey: { type: String, index: true },
  customer: Schema.Types.Mixed,
  items: [Schema.Types.Mixed],
  holds: [Schema.Types.Mixed],
  couponCode: String,
  coupon: Schema.Types.Mixed,
  promoterAttribution: Schema.Types.Mixed,
  taxes: [Schema.Types.Mixed],
  pricing: moneySchema,
  recoveryState: Schema.Types.Mixed,
  validation: Schema.Types.Mixed,
  paymentId: { type: String, index: true },
  paymentRef: { type: String, index: true },
  bookingRef: { type: String, index: true },
  bookingGroupId: { type: String, index: true },
  bookingGroupRef: { type: String, index: true },
  childBookingRefs: [String],
  expiresAt: Date,
  checkedOutAt: Date,
  createdBy: String,
}, { timestamps: true });

cartSchema.index({ status: 1, expiresAt: 1 });
cartSchema.index({ userId: 1, createdAt: -1 });

module.exports = model('Cart', cartSchema);

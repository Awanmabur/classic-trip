const { Schema, moneySchema, model } = require('./_helpers');

const bookingGroupSchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  groupRef: { type: String, unique: true, required: true, index: true },
  cartRef: { type: String, required: true, index: true },
  customerUserId: { type: String, index: true },
  customerSnapshot: Schema.Types.Mixed,
  bookingRefs: [{ type: String, index: true }],
  companyIds: [{ type: String, index: true }],
  serviceTypes: [String],
  pricing: moneySchema,
  paymentId: { type: String, index: true },
  paymentRef: { type: String, index: true },
  paymentProvider: String,
  paymentStatus: { type: String, default: 'pending', enum: ['pending', 'successful', 'failed', 'expired', 'refunded'], index: true },
  status: { type: String, default: 'pending_payment', enum: ['pending_payment', 'confirmed', 'failed', 'cancelled', 'partially_cancelled', 'completed', 'refunded'], index: true },
  checkoutUrl: String,
  metadata: Schema.Types.Mixed,
}, { timestamps: true });

bookingGroupSchema.index({ customerUserId: 1, createdAt: -1 });
bookingGroupSchema.index({ companyIds: 1, createdAt: -1 });
module.exports = model('BookingGroup', bookingGroupSchema);

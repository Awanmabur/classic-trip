const { Schema, model } = require('./_helpers');

const busReservationSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  bookingItemId: { type: String, required: true, unique: true, index: true },
  bookingId: { type: String, required: true, index: true },
  bookingRef: { type: String, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  listingId: { type: String, required: true, index: true },
  routeId: { type: String, required: true, index: true },
  scheduleId: { type: String, required: true, index: true },
  vehicleId: { type: String, required: true, index: true },
  seatMapVersionId: { type: String, required: true, index: true },
  fareProductId: { type: String, required: true, index: true },
  originStopId: { type: String, required: true, index: true },
  destinationStopId: { type: String, required: true, index: true },
  originOrder: { type: Number, required: true, min: 0 },
  destinationOrder: { type: Number, required: true, min: 1 },
  segmentIds: [{ type: String, index: true }],
  passengerCount: { type: Number, required: true, min: 1, max: 10 },
  holdId: { type: String, required: true, index: true },
  priceSnapshot: { type: Schema.Types.Mixed, required: true },
  routeSnapshot: { type: Schema.Types.Mixed, required: true },
  status: {
    type: String,
    enum: ['holding_inventory', 'awaiting_payment', 'confirmed', 'boarding', 'departed', 'completed', 'cancellation_pending', 'cancelled', 'refunded', 'expired', 'failed', 'disputed'],
    default: 'holding_inventory',
    index: true,
  },
  confirmedAt: Date,
  cancelledAt: Date,
  cancellationReason: String,
}, { timestamps: true });

busReservationSchema.index({ companyId: 1, scheduleId: 1, status: 1 });
module.exports = model('BusReservation', busReservationSchema);

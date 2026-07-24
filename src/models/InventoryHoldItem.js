const { Schema, model } = require('./_helpers');

const inventoryHoldItemSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  holdId: { type: String, required: true, index: true },
  resourceType: {
    type: String,
    required: true,
    enum: ['schedule_seat', 'bus_seat_segment', 'room_unit_night', 'capacity'],
    index: true,
  },
  resourceKey: { type: String, required: true, index: true },
  serviceType: {
    type: String,
    index: true,
    enum: ['bus', 'hotel'],
  },
  companyId: { type: String, index: true },
  listingId: { type: String, index: true },
  scheduleId: { type: String, index: true },
  seatNumber: { type: String, index: true },
  routeId: { type: String, index: true },
  segmentId: { type: String, index: true },
  segmentOrder: Number,
  originStopId: { type: String, index: true },
  destinationStopId: { type: String, index: true },
  roomTypeId: { type: String, index: true },
  roomUnitId: { type: String, index: true },
  nightDate: { type: Date, index: true },
  selectedLabel: String,
  status: {
    type: String,
    enum: ['active', 'consumed', 'expired', 'released'],
    default: 'active',
    index: true,
  },
  expiresAt: { type: Date, required: true, index: true },
  consumedAt: Date,
  consumedBy: String,
  bookingId: { type: String, index: true },
  bookingRef: { type: String, index: true },
  releasedAt: Date,
  releaseReason: String,
  metadata: Schema.Types.Mixed,
}, { timestamps: true });

inventoryHoldItemSchema.index({ holdId: 1, status: 1 });
inventoryHoldItemSchema.index({ resourceType: 1, resourceKey: 1, status: 1, expiresAt: 1 });
inventoryHoldItemSchema.index(
  { resourceKey: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } }
);

module.exports = model('InventoryHoldItem', inventoryHoldItemSchema);

const { Schema, model } = require('./_helpers');

const inventoryHoldSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  holdType: { type: String, enum: ['seat', 'bus_segment_seat', 'room'], required: true, index: true },
  serviceType: { type: String, index: true, enum: ['bus', 'hotel'] },
  listingId: { type: String, index: true },
  companyId: { type: String, index: true },
  scheduleId: { type: String, index: true },
  roomTypeId: { type: String, index: true },
  roomUnitIds: [{ type: String, index: true }],
  startDate: String,
  endDate: String,
  seatNumber: { type: String, index: true },
  seatNumbers: [{ type: String, index: true }],
  routeId: { type: String, index: true },
  originStopId: { type: String, index: true },
  destinationStopId: { type: String, index: true },
  originOrder: Number,
  destinationOrder: Number,
  segmentIds: [{ type: String, index: true }],
  itemIds: [{ type: String }],
  itemCount: { type: Number, default: 0 },
  selectedLabel: String,
  token: { type: String, index: true },
  guest: Schema.Types.Mixed,
  status: { type: String, enum: ['active', 'consumed', 'expired', 'released'], default: 'active', index: true },
  lockedUntil: { type: Date, index: true },
  expiresAt: { type: Date, index: true },
  consumedAt: Date,
  consumedBy: String,
  bookingId: { type: String, index: true },
  bookingRef: { type: String, index: true },
  releasedAt: Date,
  releaseReason: String,
  createdBy: String,
  source: String,
  meta: Schema.Types.Mixed,
}, { timestamps: true });

inventoryHoldSchema.index({ holdType: 1, status: 1, expiresAt: 1 });
inventoryHoldSchema.index({ scheduleId: 1, seatNumber: 1, status: 1 });
inventoryHoldSchema.index({ roomUnitIds: 1, status: 1, expiresAt: 1 });

module.exports = model('InventoryHold', inventoryHoldSchema);

const { Schema, model } = require('./_helpers');

const inventoryHoldSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  holdType: { type: String, enum: ['seat', 'room'], required: true, index: true },
  serviceType: { type: String, index: true },
  listingId: { type: String, index: true },
  companyId: { type: String, index: true },
  scheduleId: { type: String, index: true },
  roomId: { type: String, index: true },
  seatNumber: { type: String, index: true },
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
inventoryHoldSchema.index(
  { scheduleId: 1, seatNumber: 1, holdType: 1, status: 1 },
  { unique: true, partialFilterExpression: { holdType: 'seat', status: 'active' } }
);
inventoryHoldSchema.index({ roomId: 1, status: 1, expiresAt: 1 });
inventoryHoldSchema.index(
  { roomId: 1, holdType: 1, status: 1 },
  { unique: true, partialFilterExpression: { holdType: 'room', status: 'active' } }
);

module.exports = model('InventoryHold', inventoryHoldSchema);

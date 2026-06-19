const { Schema, model } = require('./_helpers');

const roomNightInventorySchema = new Schema({
  id: { type: String, index: true },
  companyId: { type: String, required: true, index: true },
  listingId: { type: String, required: true, index: true },
  propertyId: { type: String, index: true },
  roomTypeId: { type: String, index: true },
  roomUnitId: { type: String, index: true },
  roomId: { type: String, index: true },
  date: { type: String, required: true, index: true },
  price: Number,
  status: { type: String, default: 'available', index: true },
  holdId: String,
  bookingRef: { type: String, index: true },
  guestName: String,
  checkInStatus: String,
  notes: String,
}, { timestamps: true });

roomNightInventorySchema.index({ roomUnitId: 1, date: 1 }, { unique: true, sparse: true });
module.exports = model('RoomNightInventory', roomNightInventorySchema);

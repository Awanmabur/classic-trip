const { Schema, mediaSchema, model } = require('./_helpers');

const roomUnitSchema = new Schema({
  id: { type: String, index: true },
  companyId: { type: String, required: true, index: true },
  listingId: { type: String, required: true, index: true },
  propertyId: { type: String, index: true },
  roomTypeId: { type: String, required: true, index: true },
  roomId: { type: String, index: true },
  unitNumber: { type: String, required: true, index: true },
  floor: String,
  wing: String,
  status: { type: String, default: 'available', index: true },
  housekeepingStatus: { type: String, default: 'clean' },
  notes: String,
  media: [mediaSchema],
  documents: [mediaSchema],
}, { timestamps: true });

module.exports = model('RoomUnit', roomUnitSchema);

const { Schema, model } = require('./_helpers');

const tourPackageInventorySchema = new Schema({
  id: { type: String, index: true }, packageId: String, packageName: String, tourDate: Date, capacity: Number, availableCapacity: Number,
  guideId: String, guideName: String, pickupPoints: [String], participants: [{ fullName: String, phone: String, voucherNumber: String, checkInStatus: String }],
  status: { type: String, default: 'planned' },
}, { timestamps: true });
module.exports = model('TourPackageInventory', tourPackageInventorySchema);

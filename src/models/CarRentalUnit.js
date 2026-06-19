const { Schema, model } = require('./_helpers');

const carRentalUnitSchema = new Schema({
  id: { type: String, index: true }, companyId: String, vehicleId: String, vehicleName: String, pickupLocationId: String, returnLocationId: String,
  availableFrom: Date, availableTo: Date, withDriverAvailable: Boolean, selfDriveAvailable: Boolean, requiredDocuments: [String], depositAmount: Number,
  pickupInspectionId: String, returnInspectionId: String, damageCaseIds: [String], status: { type: String, default: 'planned' },
}, { timestamps: true });
module.exports = model('CarRentalUnit', carRentalUnitSchema);

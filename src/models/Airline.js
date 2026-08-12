const { Schema, mediaSchema, model } = require('./_helpers');
const airlineSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  companyId: { type: String, index: true },
  name: { type: String, required: true, trim: true, text: true },
  iataCode: { type: String, uppercase: true, trim: true, index: true },
  icaoCode: { type: String, uppercase: true, trim: true, index: true },
  callsign: String,
  country: String,
  logo: mediaSchema,
  operatingLicenceRef: String,
  supplierMode: { type: String, enum: ['native_inventory', 'external_certified', 'referral_only'], default: 'native_inventory', index: true },
  status: { type: String, enum: ['draft', 'active', 'suspended', 'archived'], default: 'draft', index: true },
}, { timestamps: true });
airlineSchema.index({ companyId: 1, iataCode: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['draft', 'active', 'suspended'] }, iataCode: { $exists: true } } });
module.exports = model('Airline', airlineSchema);

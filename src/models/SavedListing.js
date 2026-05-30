const { Schema, model } = require('./_helpers');

const savedListingSchema = new Schema({
  id: { type: String, index: true },
  userId: { type: String, required: true, index: true },
  listingId: { type: String, required: true, index: true },
  companyId: { type: String, index: true },
  serviceType: { type: String, index: true },
  status: { type: String, default: 'saved', index: true },
  notes: String,
}, { timestamps: true });

savedListingSchema.index({ userId: 1, listingId: 1 }, { unique: true });
module.exports = model('SavedListing', savedListingSchema);

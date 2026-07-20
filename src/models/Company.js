const { Schema, mediaSchema, model } = require('./_helpers');

const companySchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  ownerId: { type: String, index: true },
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, index: true },
  companyType: { type: String, index: true },
  country: String,
  city: String,
  description: String,
  logo: mediaSchema,
  coverImage: mediaSchema,
  verificationStatus: { type: String, enum: ['pending', 'verified', 'rejected', 'suspended'], default: 'pending', index: true },
  documents: [mediaSchema],
  supportContacts: Schema.Types.Mixed,
  walletId: String,
  ratingAverage: Number,
  reviewCount: Number,
  // The single currency this company operates in - every listing, schedule, and booking under
  // it derives its currency from here. One currency per company, not per listing: mixing
  // currencies within one company's own wallet was the root cause of amounts silently being
  // summed together as if they were the same unit.
  operatingCurrency: { type: String, default: 'UGX' },
  settings: Schema.Types.Mixed,
}, { timestamps: true });

module.exports = model('Company', companySchema);

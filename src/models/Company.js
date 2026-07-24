const { Schema, mediaSchema, model } = require('./_helpers');
const { ALL_SERVICE_TYPES } = require('../config/serviceRegistry');

const companySchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  ownerId: { type: String, index: true },
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, index: true },
  companyType: { type: String, index: true, enum: ALL_SERVICE_TYPES },
  country: String,
  city: String,
  legalName: String,
  registrationNumber: { type: String, index: true },
  taxNumber: { type: String, index: true },
  headOfficeAddress: String,
  website: String,
  description: String,
  logo: mediaSchema,
  coverImage: mediaSchema,
  status: { type: String, enum: ['pending', 'active', 'suspended', 'rejected'], default: 'pending', index: true },
  verificationStatus: { type: String, enum: ['pending', 'verified', 'rejected', 'suspended'], default: 'pending', index: true },
  documents: [mediaSchema],
  supportContacts: Schema.Types.Mixed,
  payoutAccount: Schema.Types.Mixed,
  payoutAccountProvider: String,
  payoutAccountName: String,
  reviewedBy: String,
  reviewedAt: Date,
  reviewNotes: String,
  walletId: String,
  ratingAverage: Number,
  reviewCount: Number,
  // The single currency this company operates in - every listing, schedule, and booking under
  // it derives its currency from here. One currency per company, not per listing: mixing
  // currencies within one company's own wallet was the root cause of amounts silently being
  // summed together as if they were the same unit.
  operatingCurrency: { type: String, required: true, uppercase: true, trim: true },
  commercialTerms: {
    model: { type: String, enum: ['percentage_commission'], default: 'percentage_commission' },
    commissionPercent: { type: Number, min: 0, max: 100, default: 0 },
    promoterFunding: { type: String, enum: ['platform_commission'], default: 'platform_commission' },
    termsVersion: { type: String, default: 'commission-v1' },
    acceptedAt: Date,
    acceptedBy: String,
    source: { type: String, enum: ['platform_default', 'admin_override'], default: 'platform_default' },
    updatedAt: Date,
    updatedBy: String,
  },
  settings: Schema.Types.Mixed,
}, { timestamps: true });

module.exports = model('Company', companySchema);

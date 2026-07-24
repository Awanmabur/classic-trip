const { Schema, model } = require('./_helpers');

const companyBranchSchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  companyId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true },
  branchType: { type: String, default: 'terminal', index: true, enum: ['terminal', 'branch', 'pickup_point', 'dropoff_point', 'office', 'property', 'front_desk'] },
  terminalCode: String,
  city: String,
  country: String,
  address: String,
  contactName: String,
  contactPhone: String,
  contactEmail: String,
  operatingHours: String,
  serviceCategories: [String],
  amenities: [String],
  status: { type: String, default: 'active', index: true, enum: ['active', 'paused', 'archived'] },
  createdBy: String,
  updatedBy: String,
}, { timestamps: true });

companyBranchSchema.index({ companyId: 1, name: 1 });

module.exports = model('CompanyBranch', companyBranchSchema);

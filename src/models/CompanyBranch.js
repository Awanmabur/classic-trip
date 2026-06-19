const { Schema, model } = require('./_helpers');

const companyBranchSchema = new Schema({
  id: { type: String, index: true },
  companyId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true },
  branchType: { type: String, default: 'terminal', index: true },
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
  status: { type: String, default: 'active', index: true },
  createdBy: String,
  updatedBy: String,
}, { timestamps: true });

companyBranchSchema.index({ companyId: 1, name: 1 });

module.exports = model('CompanyBranch', companyBranchSchema);

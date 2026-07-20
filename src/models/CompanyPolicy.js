const { Schema, model } = require('./_helpers');

const companyPolicySchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  companyId: { type: String, required: true, index: true },
  title: { type: String, required: true, trim: true },
  policyType: { type: String, default: 'operations', index: true },
  serviceCategory: String,
  summary: String,
  customerVisible: { type: Boolean, default: false },
  appliesToBranches: [String],
  status: { type: String, default: 'active', index: true },
  createdBy: String,
  updatedBy: String,
}, { timestamps: true });

companyPolicySchema.index({ companyId: 1, policyType: 1 });

module.exports = model('CompanyPolicy', companyPolicySchema);

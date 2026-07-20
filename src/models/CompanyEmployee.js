const { Schema, mediaSchema, model } = require('./_helpers');

const companyEmployeeSchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  companyId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  roleTitle: String,
  branch: String,
  permissions: [String],
  documents: [mediaSchema],
  status: { type: String, default: 'active', index: true },
  invitedAt: Date,
}, { timestamps: true });

module.exports = model('CompanyEmployee', companyEmployeeSchema);

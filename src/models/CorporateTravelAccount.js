const { Schema, model } = require('./_helpers');

const corporateTravelAccountSchema = new Schema({
  id: { type: String, index: true }, companyAccountId: String, companyName: String, employeeTravelers: [{ userId: String, name: String, email: String }],
  approvalWorkflow: [{ level: Number, approverUserId: String, rule: String }], monthlyInvoiceId: String, travelPolicyId: String, status: { type: String, default: 'planned' },
}, { timestamps: true });
module.exports = model('CorporateTravelAccount', corporateTravelAccountSchema);

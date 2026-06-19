const { Schema, model } = require('./_helpers');

const insurancePolicyRecordSchema = new Schema({
  id: { type: String, index: true }, policyNumber: { type: String, index: true }, providerId: String, coverageType: String, coverageSummary: String,
  premium: Number, currency: String, beneficiary: { name: String, phone: String, email: String }, bookingRef: String, claimLink: String, status: { type: String, default: 'planned' },
}, { timestamps: true });
module.exports = model('InsurancePolicyRecord', insurancePolicyRecordSchema);

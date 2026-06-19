const { Schema, model } = require('./_helpers');

const agreementSchema = new Schema({
  id: { type: String, index: true },
  leadId: { type: String, index: true },
  sessionId: { type: String, index: true },
  invitationId: { type: String, index: true },
  agreementType: { type: String, index: true },
  partnerName: String,
  contactEmail: { type: String, lowercase: true, trim: true },
  contactPhone: String,
  commissionModel: String,
  subscriptionPlan: String,
  payoutFrequency: String,
  cancellationRules: String,
  serviceLevelExpectations: String,
  documentRequirements: String,
  operatingRegions: [String],
  startDate: Date,
  expiresAt: Date,
  status: { type: String, enum: ['draft', 'sent', 'agreed', 'approved', 'rejected', 'expired', 'suspended', 'terminated'], default: 'draft', index: true },
  approvalHistory: [Schema.Types.Mixed],
  termsSummary: String,
  createdBy: String,
  updatedBy: String,
  approvedBy: String,
  approvedAt: Date,
  meta: Schema.Types.Mixed,
}, { timestamps: true });

agreementSchema.index({ status: 1, createdAt: -1 });
agreementSchema.index({ agreementType: 1, status: 1 });
module.exports = model('Agreement', agreementSchema);

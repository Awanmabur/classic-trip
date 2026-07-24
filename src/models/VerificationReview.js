const { Schema, model } = require('./_helpers');

const verificationChecklistItemSchema = new Schema({
  key: String,
  label: String,
  required: { type: Boolean, default: true },
  status: { type: String, enum: ['missing', 'submitted', 'approved', 'rejected', 'waived'], default: 'missing' },
  value: String,
  documentReference: String,
  notes: String,
  submittedBy: String,
  submittedAt: Date,
  reviewedBy: String,
  reviewedAt: Date,
  reviewNotes: String,
}, { _id: false });

const verificationReviewSchema = new Schema({
  id: { type: String, index: true },
  targetType: { type: String, enum: ['company', 'driver', 'provider', 'promoter'], index: true },
  targetId: { type: String, index: true },
  companyId: { type: String, index: true },
  invitationId: { type: String, index: true },
  status: { type: String, enum: ['draft', 'pending_review', 'approved', 'company_activated', 'rejected', 'activated'], default: 'draft', index: true },
  riskLevel: { type: String, default: 'medium', enum: ['low', 'medium', 'high', 'critical'] },
  checklist: [verificationChecklistItemSchema],
  documents: [Schema.Types.Mixed],
  payoutAccount: Schema.Types.Mixed,
  supportContacts: Schema.Types.Mixed,
  inventorySummary: Schema.Types.Mixed,
  agreementSummary: String,
  submittedBy: String,
  submittedAt: Date,
  reviewedBy: String,
  reviewedAt: Date,
  activatedBy: String,
  activatedAt: Date,
  rejectionReason: String,
  auditTrail: [Schema.Types.Mixed],
}, { timestamps: true });

module.exports = model('VerificationReview', verificationReviewSchema);

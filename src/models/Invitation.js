const { Schema, model } = require('./_helpers');

const invitationSchema = new Schema({
  id: { type: String, index: true },
  token: { type: String, index: true },
  tokenHash: { type: String, index: true },
  tokenPreview: String,
  type: { type: String, enum: ['company', 'driver', 'hotel', 'fleet_owner', 'promoter', 'agent', 'service_provider', 'admin'], default: 'company', index: true },
  status: { type: String, enum: ['draft', 'requested', 'sent', 'accepted', 'revoked', 'expired', 'rejected'], default: 'sent', index: true },
  email: { type: String, lowercase: true, trim: true, index: true },
  phone: String,
  fullName: String,
  companyId: { type: String, index: true },
  leadId: { type: String, index: true },
  agreementId: { type: String, index: true },
  companyName: String,
  role: String,
  roleTitle: String,
  permissions: [String],
  commissionPlan: String,
  subscriptionPlan: String,
  termsSummary: String,
  startDate: Date,
  requestedBy: String,
  sentBy: String,
  resentBy: String,
  revokedBy: String,
  acceptedBy: String,
  expiresAt: { type: Date, index: true },
  sentAt: Date,
  resentAt: Date,
  revokedAt: Date,
  acceptedAt: Date,
  rejectedAt: Date,
  rejectionReason: String,
  accountSetup: Schema.Types.Mixed,
  meta: Schema.Types.Mixed,
}, { timestamps: true });

invitationSchema.index({ type: 1, status: 1, createdAt: -1 });
invitationSchema.index({ companyId: 1, status: 1 });
module.exports = model('Invitation', invitationSchema);

const { Schema, model } = require('./_helpers');

const partnerLeadSchema = new Schema({
  id: { type: String, index: true },
  leadType: { type: String, index: true },
  businessName: { type: String, index: true },
  contactName: String,
  phone: String,
  email: { type: String, lowercase: true, trim: true, index: true },
  whatsapp: String,
  city: String,
  country: String,
  serviceCategory: String,
  sourceChannel: String,
  notes: String,
  status: { type: String, default: 'new', index: true },
  assignedTo: String,
  createdBy: String,
  updatedBy: String,
  latestSessionId: String,
  latestAgreementId: String,
  convertedInvitationId: String,
  convertedAt: Date,
  meta: Schema.Types.Mixed,
}, { timestamps: true });

partnerLeadSchema.index({ status: 1, createdAt: -1 });
partnerLeadSchema.index({ leadType: 1, status: 1 });
module.exports = model('PartnerLead', partnerLeadSchema);

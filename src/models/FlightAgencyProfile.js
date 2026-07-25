const { Schema, model } = require('./_helpers');

const flightAgencyProfileSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  companyId: { type: String, unique: true, required: true, index: true },
  legalName: { type: String, required: true, trim: true },
  tradingName: { type: String, trim: true },
  agencyType: { type: String, enum: ['travel_agency', 'ticketing_agent', 'corporate_travel', 'online_travel_agent'], default: 'travel_agency' },
  accreditationType: { type: String, enum: ['iata', 'tids', 'local_licence', 'consolidator_subagent', 'none'], default: 'none' },
  accreditationNumber: { type: String, trim: true, index: true },
  accreditationExpiresAt: Date,
  businessLicenceNumber: { type: String, trim: true },
  businessLicenceExpiresAt: Date,
  ticketingAuthorityRequested: { type: Boolean, default: false },
  ticketingAuthorityApproved: { type: Boolean, default: false },
  canCollectPayment: { type: Boolean, default: true },
  canServiceChanges: { type: Boolean, default: false },
  canRequestRefunds: { type: Boolean, default: true },
  status: { type: String, enum: ['draft', 'submitted', 'under_review', 'changes_required', 'approved', 'rejected', 'suspended'], default: 'draft', index: true },
  reviewNotes: String,
  submittedAt: Date,
  reviewedAt: Date,
  reviewedBy: { type: String, index: true },
  createdBy: { type: String, index: true },
  updatedBy: { type: String, index: true },
}, { timestamps: true });

module.exports = model('FlightAgencyProfile', flightAgencyProfileSchema);

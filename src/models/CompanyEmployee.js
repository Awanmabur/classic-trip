const { Schema, mediaSchema, model } = require('./_helpers');

const companyEmployeeSchema = new Schema({
  id: { type: String, unique: true, sparse: true, index: true },
  companyId: { type: String, required: true, index: true },
  // A driver request is a real assignable company record before the invited
  // person creates an account. userId is linked later when the invitation is
  // accepted; MongoDB remains the source of truth for the lifecycle.
  userId: { type: String, default: '', index: true },
  fullName: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true, index: true },
  phone: { type: String, trim: true, index: true },
  invitationId: { type: String, trim: true, index: true },
  requestTicketId: { type: String, trim: true, index: true },
  roleTitle: String,
  branchId: { type: String, index: true },
  branchName: String,
  branch: String, // compatibility display snapshot; branchId is authoritative
  listingIds: [{ type: String, index: true }],
  scheduleIds: [{ type: String, index: true }],
  serviceCategories: [String],
  permissions: [String],
  documents: [mediaSchema],
  licenseNumber: String,
  licenseClass: String,
  licenseExpiresAt: Date,
  assignedFleetId: { type: String, index: true },
  pendingVehicleId: { type: String, index: true },
  pendingScheduleId: { type: String, index: true },
  shift: String,
  notes: String,
  safetyStatus: { type: String, enum: ['not_submitted', 'pending_review', 'cleared', 'rejected'], default: 'not_submitted' },
  onboardingStatus: { type: String, trim: true, index: true },
  verifiedBy: String,
  verifiedAt: Date,
  driverProfileUpdatedAt: Date,
  lastAssignedAt: Date,
  status: { type: String, default: 'requested', index: true, enum: ['requested', 'invited', 'pending_verification', 'active', 'suspended', 'rejected', 'revoked'] },
  invitedAt: Date,
  acceptedAt: Date,
  approvedAt: Date,
  approvedBy: String,
  suspendedAt: Date,
  rejectedAt: Date,
}, { timestamps: true });

module.exports = model('CompanyEmployee', companyEmployeeSchema);

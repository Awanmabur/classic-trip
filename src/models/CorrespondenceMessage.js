const { Schema, model } = require('./_helpers');

const correspondenceMessageSchema = new Schema({
  id: { type: String, index: true },
  threadId: { type: String, index: true },
  ownerType: { type: String, index: true, enum: ['company', 'customer', 'promoter', 'guest', 'partner_lead', 'platform', 'support'] },
  ownerId: { type: String, index: true },
  companyId: { type: String, index: true },
  customerUserId: { type: String, index: true },
  bookingId: { type: String, index: true },
  bookingRef: { type: String, index: true },
  ticketId: { type: String, index: true },
  refundId: { type: String, index: true },
  supportTicketId: { type: String, index: true },
  agreementId: { type: String, index: true },
  verificationId: { type: String, index: true },
  driverId: { type: String, index: true },
  customerId: { type: String, index: true },
  payoutRequestId: { type: String, index: true },
  subject: String,
  message: String,
  category: { type: String, index: true, enum: ['Partner onboarding', 'Fraud review', 'Payout report', 'platform_notice', 'customer_note', 'verification', 'driver_invitation_request', 'Booking issue', 'Refund request', 'Ticket not received', 'Payment issue', 'Partner inquiry', 'Promoter inquiry', 'Other', 'Public support', 'Customer support', 'Promoter support', 'support'] },
  direction: { type: String, index: true, enum: ['inbound', 'outbound'] },
  visibility: { type: String, default: 'shared', index: true, enum: ['shared', 'internal'] },
  actorType: { type: String, index: true, enum: ['customer', 'system', 'company', 'employee', 'admin', 'promoter', 'support'] },
  actorId: { type: String, index: true },
  actorName: String,
  status: { type: String, default: 'open', index: true, enum: ['open', 'pending', 'resolved', 'closed', 'pending_super_admin_approval'] },
  channels: [String],
  deliveryAttemptIds: [String],
  tags: [String],
  metadata: Schema.Types.Mixed,
}, { timestamps: true });

correspondenceMessageSchema.index({ bookingRef: 1, createdAt: -1 });
correspondenceMessageSchema.index({ supportTicketId: 1, createdAt: -1 });
correspondenceMessageSchema.index({ companyId: 1, createdAt: -1 });
correspondenceMessageSchema.index({ visibility: 1, createdAt: -1 });

module.exports = model('CorrespondenceMessage', correspondenceMessageSchema);

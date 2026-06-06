const { Schema, model } = require('./_helpers');

const supportTicketSchema = new Schema({
  id: { type: String, index: true },
  ownerType: { type: String, index: true },
  ownerId: { type: String, index: true },
  userId: { type: String, index: true },
  companyId: { type: String, index: true },
  bookingId: { type: String, index: true },
  bookingRef: { type: String, index: true },
  paymentId: { type: String, index: true },
  subject: String,
  category: { type: String, index: true },
  audience: { type: String, index: true },
  message: String,
  priority: { type: String, default: 'medium', index: true },
  status: { type: String, default: 'open', index: true },
  assignedTo: { type: String, index: true },
  assignedBy: String,
  assignedAt: Date,
  createdBy: String,
  resolutionNotes: String,
  resolvedBy: String,
  resolvedAt: Date,
  reopenedBy: String,
  reopenedAt: Date,
  replies: [Schema.Types.Mixed],
  metadata: Schema.Types.Mixed,
}, { timestamps: true });

supportTicketSchema.index({ companyId: 1, status: 1, priority: 1 });
supportTicketSchema.index({ ownerId: 1, ownerType: 1, createdAt: -1 });
module.exports = model('SupportTicket', supportTicketSchema);

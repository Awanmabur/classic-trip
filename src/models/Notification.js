const { Schema, model } = require('./_helpers');

const notificationSchema = new Schema({
  id: { type: String, index: true },
  userId: { type: String, index: true },
  ownerType: { type: String, index: true, enum: ['company', 'customer', 'promoter', 'guest', 'partner_lead', 'platform', 'support', ''] },
  ownerId: { type: String, index: true },
  audience: { type: String, index: true, enum: ['customers', 'admins', 'partners', 'staff', 'promoters', 'customer', ''] },
  channel: { type: String, enum: ['email', 'push', 'sms', 'whatsapp', 'in_app', 'system'] },
  channels: [String],
  title: String,
  message: String,
  body: String,
  recipient: Schema.Types.Mixed,
  createdBy: String,
  referenceType: { type: String, enum: ['booking', 'payment', 'refund', 'company_employee', 'support_ticket', 'correspondence_message', 'partner_lead', 'invitation', 'email_verification', 'cart_booking', 'booking_group'] },
  referenceId: String,
  meta: Schema.Types.Mixed,
  status: { type: String, default: 'queued', index: true, enum: ['queued', 'sent', 'failed', 'skipped', 'read', 'dismissed', 'archived'] },
  deliveryStatus: { type: String, default: 'queued', index: true, enum: ['queued', 'sent', 'failed', 'skipped', 'delivered'] },
  deliveryProvider: { type: String, enum: ['smtp', 'http', 'web-push', 'classic_trip_in_app', 'email', 'push', 'sms', 'whatsapp', 'in_app', 'system'] },
  deliveryResponse: Schema.Types.Mixed,
  sentCount: { type: Number, default: 0 },
  deliveredCount: { type: Number, default: 0 },
  failedCount: { type: Number, default: 0 },
  sentAt: Date,
}, { timestamps: true });

notificationSchema.index({ audience: 1, status: 1, createdAt: -1 });
module.exports = model('Notification', notificationSchema);

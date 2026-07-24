const { Schema, model } = require('./_helpers');

const notificationDeliveryAttemptSchema = new Schema({
  id: { type: String, index: true },
  notificationId: { type: String, index: true },
  correspondenceMessageId: { type: String, index: true },
  referenceType: { type: String, index: true, enum: ['booking', 'payment', 'refund', 'company_employee', 'support_ticket', 'correspondence_message', 'partner_lead', 'invitation', 'email_verification'] },
  referenceId: { type: String, index: true },
  bookingRef: { type: String, index: true },
  userId: { type: String, index: true },
  channel: { type: String, index: true, enum: ['email', 'push', 'sms', 'whatsapp', 'in_app'] },
  recipient: Schema.Types.Mixed,
  provider: { type: String, enum: ['smtp', 'http', 'web-push', 'classic_trip_in_app', 'email', 'push', 'sms', 'whatsapp', 'in_app'] },
  status: { type: String, default: 'queued', index: true, enum: ['queued', 'sent', 'failed', 'skipped', 'delivered'] },
  response: Schema.Types.Mixed,
  error: String,
  attemptedAt: Date,
  completedAt: Date,
  metadata: Schema.Types.Mixed,
}, { timestamps: true });

notificationDeliveryAttemptSchema.index({ bookingRef: 1, createdAt: -1 });
notificationDeliveryAttemptSchema.index({ channel: 1, status: 1 });

module.exports = model('NotificationDeliveryAttempt', notificationDeliveryAttemptSchema);

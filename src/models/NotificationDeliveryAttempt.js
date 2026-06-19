const { Schema, model } = require('./_helpers');

const notificationDeliveryAttemptSchema = new Schema({
  id: { type: String, index: true },
  notificationId: { type: String, index: true },
  correspondenceMessageId: { type: String, index: true },
  referenceType: { type: String, index: true },
  referenceId: { type: String, index: true },
  bookingRef: { type: String, index: true },
  userId: { type: String, index: true },
  channel: { type: String, index: true },
  recipient: Schema.Types.Mixed,
  provider: String,
  status: { type: String, default: 'queued', index: true },
  response: Schema.Types.Mixed,
  error: String,
  attemptedAt: Date,
  completedAt: Date,
  metadata: Schema.Types.Mixed,
}, { timestamps: true });

notificationDeliveryAttemptSchema.index({ bookingRef: 1, createdAt: -1 });
notificationDeliveryAttemptSchema.index({ channel: 1, status: 1 });

module.exports = model('NotificationDeliveryAttempt', notificationDeliveryAttemptSchema);

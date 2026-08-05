const { Schema, model } = require('./_helpers');

const notificationSchema = new Schema({
  id: { type: String, index: true },
  userId: { type: String, index: true },
  // Notification ownership and audience are extensible domain labels. Keeping
  // these as enums caused valid verification, invitation, operations and payout
  // notifications to fail validation when a new workflow was added.
  ownerType: { type: String, index: true },
  ownerId: { type: String, index: true },
  audience: { type: String, index: true },
  channel: { type: String, enum: ['email', 'push', 'sms', 'whatsapp', 'in_app', 'system'] },
  channels: [String],
  title: String,
  message: String,
  body: String,
  recipient: Schema.Types.Mixed,
  createdBy: String,
  referenceType: { type: String, index: true },
  referenceId: String,
  dedupeKey: { type: String, unique: true, sparse: true, index: true },
  meta: Schema.Types.Mixed,
  status: { type: String, default: 'queued', index: true, enum: ['queued', 'sent', 'failed', 'skipped', 'read', 'dismissed', 'archived'] },
  deliveryStatus: { type: String, default: 'queued', index: true, enum: ['queued', 'sent', 'failed', 'skipped', 'delivered'] },
  deliveryProvider: String,
  deliveryResponse: Schema.Types.Mixed,
  sentCount: { type: Number, default: 0 },
  deliveredCount: { type: Number, default: 0 },
  failedCount: { type: Number, default: 0 },
  sentAt: Date,
  dispatchOwner: String,
  dispatchLeaseUntil: Date,
  dispatchAttempts: { type: Number, default: 0 },
}, { timestamps: true });

notificationSchema.index({ audience: 1, status: 1, createdAt: -1 });
notificationSchema.index({ ownerType: 1, ownerId: 1, status: 1, createdAt: -1 });
notificationSchema.index({ audience: 1, ownerId: 1, status: 1, createdAt: -1 });
module.exports = model('Notification', notificationSchema);

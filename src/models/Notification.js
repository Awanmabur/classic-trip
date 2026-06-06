const { Schema, model } = require('./_helpers');

const notificationSchema = new Schema({
  id: { type: String, index: true },
  userId: { type: String, index: true },
  ownerType: { type: String, index: true },
  ownerId: { type: String, index: true },
  audience: { type: String, index: true },
  channel: String,
  channels: [String],
  title: String,
  message: String,
  body: String,
  recipient: Schema.Types.Mixed,
  createdBy: String,
  referenceType: String,
  referenceId: String,
  meta: Schema.Types.Mixed,
  status: { type: String, default: 'queued', index: true },
  deliveryStatus: { type: String, default: 'queued', index: true },
  deliveryProvider: String,
  deliveryResponse: Schema.Types.Mixed,
  sentCount: { type: Number, default: 0 },
  deliveredCount: { type: Number, default: 0 },
  failedCount: { type: Number, default: 0 },
  sentAt: Date,
}, { timestamps: true });

notificationSchema.index({ audience: 1, status: 1, createdAt: -1 });
module.exports = model('Notification', notificationSchema);

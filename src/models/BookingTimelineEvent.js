const { Schema, model } = require('./_helpers');

const bookingTimelineEventSchema = new Schema({
  id: { type: String, index: true },
  bookingId: { type: String, index: true },
  bookingRef: { type: String, index: true },
  companyId: { type: String, index: true },
  customerUserId: { type: String, index: true },
  entityType: { type: String, index: true },
  entityId: { type: String, index: true },
  action: { type: String, index: true },
  title: String,
  message: String,
  status: { type: String, index: true },
  visibility: { type: String, default: 'shared', index: true },
  actorType: { type: String, index: true },
  actorId: { type: String, index: true },
  actorName: String,
  metadata: Schema.Types.Mixed,
}, { timestamps: true });

bookingTimelineEventSchema.index({ bookingRef: 1, createdAt: -1 });
bookingTimelineEventSchema.index({ companyId: 1, createdAt: -1 });
bookingTimelineEventSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
module.exports = model('BookingTimelineEvent', bookingTimelineEventSchema);

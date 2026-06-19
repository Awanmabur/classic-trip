const { Schema, model } = require('./_helpers');

const discoverySessionSchema = new Schema({
  id: { type: String, index: true },
  leadId: { type: String, index: true },
  providerName: String,
  sessionType: String,
  scheduledAt: { type: Date, index: true },
  attendees: [String],
  location: String,
  meetingLink: String,
  notes: String,
  objections: String,
  agreedNextAction: String,
  followUpOwner: String,
  status: { type: String, default: 'scheduled', index: true },
  files: [Schema.Types.Mixed],
  createdBy: String,
  updatedBy: String,
  meta: Schema.Types.Mixed,
}, { timestamps: true });

discoverySessionSchema.index({ leadId: 1, scheduledAt: -1 });
module.exports = model('DiscoverySession', discoverySessionSchema);

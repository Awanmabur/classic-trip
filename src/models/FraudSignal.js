const { Schema, model } = require('./_helpers');

const fraudSignalSchema = new Schema({
  id: { type: String, index: true },
  promoterId: { type: String, index: true },
  agentId: { type: String, index: true },
  bookingId: String,
  bookingRef: { type: String, index: true },
  linkId: String,
  clickId: String,
  signalType: { type: String, index: true, enum: ['promoter_risk', 'booking_risk'] },
  severity: { type: String, default: 'low', index: true, enum: ['low', 'medium', 'high'] },
  score: Number,
  reasons: [String],
  status: { type: String, default: 'open', index: true, enum: ['open', 'resolved', 'cleared'] },
  assignedTo: String,
  resolution: String,
  resolvedBy: String,
  resolvedAt: Date,
  metadata: Schema.Types.Mixed,
}, { timestamps: true });

module.exports = model('FraudSignal', fraudSignalSchema);

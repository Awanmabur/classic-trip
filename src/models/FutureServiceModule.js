const { Schema, model } = require('./_helpers');

const futureServiceModuleSchema = new Schema({
  id: { type: String, index: true },
  key: { type: String, required: true, unique: true, index: true },
  label: String,
  releaseStatus: { type: String, default: 'architecture-ready', index: true },
  bookable: { type: Boolean, default: false },
  featureFlag: { type: String, index: true },
  bookingGuard: { type: String, default: 'coming_soon_read_only' },
  entities: [String],
  workflows: [String],
  readinessChecklist: [String],
  status: { type: String, default: 'planned', index: true },
  enabledAt: Date,
  enabledBy: String,
}, { timestamps: true });

module.exports = model('FutureServiceModule', futureServiceModuleSchema);

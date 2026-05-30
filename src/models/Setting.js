const { Schema, model } = require('./_helpers');

const settingSchema = new Schema({
  key: { type: String, unique: true, index: true },
  value: Schema.Types.Mixed,
  group: { type: String, index: true },
  label: String,
  description: String,
  editable: { type: Boolean, default: true },
  updatedBy: String,
}, { timestamps: true });

module.exports = model('Setting', settingSchema);

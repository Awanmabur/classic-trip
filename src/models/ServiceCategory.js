const { Schema, model } = require('./_helpers');

const serviceCategorySchema = new Schema({
  key: { type: String, unique: true, index: true },
  label: String,
  icon: String,
  bookable: Boolean,
  release: { type: String, enum: ['v1', 'teaser', 'architecture-ready'] },
  status: { type: String, default: 'active', enum: ['active'] },
}, { timestamps: true });

module.exports = model('ServiceCategory', serviceCategorySchema);

const { Schema, model } = require('./_helpers');

const serviceCategorySchema = new Schema({
  key: { type: String, unique: true, index: true },
  label: String,
  icon: String,
  bookable: Boolean,
  release: String,
  status: { type: String, default: 'active' },
}, { timestamps: true });

module.exports = model('ServiceCategory', serviceCategorySchema);

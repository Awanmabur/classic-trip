const { Schema, model } = require('./_helpers');

const serviceAddonSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  listingId: { type: String, required: true, index: true },
  serviceType: { type: String, enum: ['bus', 'hotel'], default: 'bus', index: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true, default: '' },
  category: { type: String, enum: ['baggage', 'boarding', 'communication', 'comfort', 'meal', 'insurance', 'flexibility', 'accessibility', 'other'], default: 'other', index: true },
  icon: { type: String, trim: true, default: 'fa-circle-plus' },
  price: { type: Number, required: true, min: 0 },
  currency: { type: String, required: true, uppercase: true, trim: true },
  chargeBasis: { type: String, enum: ['per_booking', 'per_passenger', 'per_trip_leg', 'per_passenger_per_leg'], default: 'per_booking' },
  availableFor: { type: String, enum: ['all', 'one_way', 'round_trip'], default: 'all' },
  maxQuantity: { type: Number, default: 1, min: 1, max: 20 },
  sortOrder: { type: Number, default: 0 },
  status: { type: String, enum: ['draft', 'active', 'paused', 'archived'], default: 'active', index: true },
  createdBy: String,
  updatedBy: String,
}, { timestamps: true });

serviceAddonSchema.index({ companyId: 1, listingId: 1, status: 1, sortOrder: 1 });
module.exports = model('ServiceAddon', serviceAddonSchema);

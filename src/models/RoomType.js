const { Schema, mediaSchema, model } = require('./_helpers');

const roomTypeSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  listingId: { type: String, required: true, index: true },
  propertyId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  normalizedName: { type: String, required: true },
  capacity: { type: Number, required: true, min: 1 },
  maxAdults: { type: Number, required: true, min: 1 },
  maxChildren: { type: Number, default: 0, min: 0 },
  maxInfants: { type: Number, default: 0, min: 0 },
  bedType: { type: String, enum: ['single', 'double', 'twin', 'queen', 'king', 'family', 'suite'], default: 'double' },
  bedConfiguration: Schema.Types.Mixed,
  sizeSqm: { type: Number, min: 0 },
  basePrice: { type: Number, required: true, min: 0 },
  defaultRatePlanId: { type: String, index: true },
  mealPlan: { type: String, enum: ['room_only', 'breakfast', 'half_board', 'full_board', 'all_inclusive'], default: 'room_only' },
  extraAdultFee: { type: Number, default: 0, min: 0 },
  extraChildFee: { type: Number, default: 0, min: 0 },
  minStay: { type: Number, default: 1, min: 1 },
  maxStay: { type: Number, default: 90, min: 1 },
  amenities: [String],
  accessibilityFeatures: [String],
  images: [mediaSchema],
  policies: [String],
  taxesAndFees: [Schema.Types.Mixed],
  status: { type: String, default: 'active', index: true, enum: ['active', 'paused', 'archived'] },
  createdBy: String,
  updatedBy: String,
}, { timestamps: true });
roomTypeSchema.index({ companyId: 1, propertyId: 1, normalizedName: 1 }, { unique: true });
module.exports = model('RoomType', roomTypeSchema);

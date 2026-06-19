const { Schema, model } = require('./_helpers');

const stayRuleSchema = new Schema({
  id: { type: String, index: true },
  companyId: { type: String, required: true, index: true },
  listingId: { type: String, index: true },
  propertyId: { type: String, index: true },
  ruleType: String,
  title: String,
  summary: String,
  appliesToRoomTypes: [String],
  status: { type: String, default: 'active', index: true },
}, { timestamps: true });

module.exports = model('StayRule', stayRuleSchema);

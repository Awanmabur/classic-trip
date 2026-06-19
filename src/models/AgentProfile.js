const { Schema, model } = require('./_helpers');

const agentProfileSchema = new Schema({
  id: { type: String, index: true },
  userId: { type: String, required: true, index: true },
  promoterId: { type: String, index: true },
  agentCode: { type: String, index: true },
  officeName: String,
  terminalId: String,
  branchId: String,
  location: String,
  payoutMethod: String,
  payoutAccount: String,
  offlineSalesEnabled: { type: Boolean, default: false },
  permissions: [String],
  dailyLimit: Number,
  status: { type: String, default: 'active', index: true },
  verifiedAt: Date,
  createdBy: String,
  updatedBy: String,
}, { timestamps: true });

module.exports = model('AgentProfile', agentProfileSchema);

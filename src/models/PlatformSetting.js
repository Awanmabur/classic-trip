const { Schema, model } = require('./_helpers');

const platformSettingSchema = new Schema({
  platformName: { type: String, default: 'Classic Trip' },
  defaultCurrency: { type: String, default: 'UGX', index: true },
  platformFeePercent: { type: Number, default: 7 },
  promoterDefaultPercent: { type: Number, default: 3 },
  supportEmail: String,
  maintenanceMode: { type: Boolean, default: false, index: true },
  termsUrl: String,
  privacyUrl: String,
  updatedBy: String,
}, { timestamps: true });

module.exports = model('PlatformSetting', platformSettingSchema);

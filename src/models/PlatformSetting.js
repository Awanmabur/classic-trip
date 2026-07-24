const { Schema, model } = require('./_helpers');

const financeRulesSchema = new Schema({
  // The only partner commercial charge: Classic Trip retains this percentage
  // of each completed booking and the partner receives the remainder.
  partnerCommissionPercent: { type: Number, min: 0, max: 100, default: 10 },
  // Promoter rewards are funded from the platform commission, never added on
  // top of the customer total and never deducted a second time from partners.
  promoterSharePercent: { type: Number, min: 0, max: 100, default: 30 },
  customerServiceFeePercent: { type: Number, min: 0, max: 100, default: 0 },
  customerServiceFeeFlat: { type: Number, min: 0, default: 0 },
  customerTaxPercent: { type: Number, min: 0, max: 100, default: 0 },
  holdMinutes: { type: Number, min: 1, max: 180, default: 10 },
  defaultCurrency: { type: String, default: 'UGX' },
  supportMessage: String,
  commercialTermsVersion: { type: String, default: 'commission-v1' },
  updatedBy: String,
  updatedAt: Date,
}, { _id: false });

const priceRuleSchema = new Schema({
  id: { type: String, required: true },
  listingId: String,
  ruleName: { type: String, required: true },
  percent: { type: Number, min: -100, max: 500, default: 0 },
  startsAt: Date,
  endsAt: Date,
  note: String,
  status: { type: String, enum: ['active', 'disabled', 'expired'], default: 'active' },
  createdBy: String,
  createdAt: Date,
}, { _id: false });

const notificationTemplateSchema = new Schema({
  id: { type: String, required: true },
  key: { type: String, required: true },
  subject: { type: String, required: true },
  body: { type: String, required: true },
  status: { type: String, enum: ['active', 'disabled'], default: 'active' },
  updatedBy: String,
  updatedAt: Date,
}, { _id: false });

const platformSettingSchema = new Schema({
  platformName: { type: String, default: 'Classic Trip' },
  supportedCurrencies: { type: [String], default: () => ['UGX', 'KES', 'RWF', 'TZS', 'BIF', 'SSP', 'USD'] },
  supportEmail: String,
  supportMessage: String,
  maintenanceMode: { type: Boolean, default: false, index: true },
  termsUrl: String,
  privacyUrl: String,
  financeRules: { type: financeRulesSchema, default: () => ({}) },
  priceRules: { type: [priceRuleSchema], default: [] },
  notificationTemplates: { type: [notificationTemplateSchema], default: [] },
  updatedBy: String,
}, { timestamps: true });

module.exports = model('PlatformSetting', platformSettingSchema);

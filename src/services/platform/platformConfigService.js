'use strict';

const platformSettingsRepository = require('../../repositories/domain/platformSettingsRepository');

const SYSTEM_DEFAULTS = Object.freeze({
  platformName: 'Classic Trip',
  defaultCurrency: 'UGX',
  supportedCurrencies: ['UGX', 'KES', 'RWF', 'TZS', 'BIF', 'SSP', 'USD'],
  partnerCommissionPercent: 10,
  promoterSharePercent: 30,
  customerServiceFeePercent: 0,
  customerServiceFeeFlat: 0,
  customerTaxPercent: 0,
  holdMinutes: 10,
  commercialTermsVersion: 'commission-v1',
  supportMessage: 'Classic Trip support is available for tickets, payments, refunds, partner onboarding, and promoter payouts.',
});

let cached = { ...SYSTEM_DEFAULTS, supportedCurrencies: [...SYSTEM_DEFAULTS.supportedCurrencies] };

function number(value, fallback, min = 0, max = 100) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function currency(value, fallback = SYSTEM_DEFAULTS.defaultCurrency) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : fallback;
}

function currencies(value, defaultCurrency) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[\s,;]+/);
  const normalized = [...new Set(source.map((item) => currency(item, '')).filter(Boolean))];
  if (!normalized.includes(defaultCurrency)) normalized.unshift(defaultCurrency);
  return normalized.length ? normalized : [...SYSTEM_DEFAULTS.supportedCurrencies];
}

function legacyCommissionPercent(finance = {}) {
  if (Number.isFinite(Number(finance.partnerCommissionPercent))) return Number(finance.partnerCommissionPercent);
  if (Number.isFinite(Number(finance.partnerPayoutPercent))) return Math.max(0, 100 - Number(finance.partnerPayoutPercent));
  const platform = Number(finance.platformFeePercent || 0);
  const promoter = Number(finance.promoterCommissionPercent || 0);
  return Math.max(0, Math.min(100, platform + promoter));
}

function legacyPromoterShare(finance = {}, partnerCommissionPercent = 0) {
  if (Number.isFinite(Number(finance.promoterSharePercent))) return Number(finance.promoterSharePercent);
  const legacyPromoterGross = Number(finance.promoterCommissionPercent || 0);
  return partnerCommissionPercent > 0
    ? Math.max(0, Math.min(100, (legacyPromoterGross / partnerCommissionPercent) * 100))
    : 0;
}

function normalize(row = {}) {
  const finance = row.financeRules && typeof row.financeRules === 'object' ? row.financeRules : {};
  const defaultCurrency = currency(finance.defaultCurrency);
  const legacyPartnerCommission = legacyCommissionPercent(finance);
  const partnerCommissionPercent = number(legacyPartnerCommission, SYSTEM_DEFAULTS.partnerCommissionPercent);
  const promoterSharePercent = number(legacyPromoterShare(finance, partnerCommissionPercent), SYSTEM_DEFAULTS.promoterSharePercent);
  const customerServiceFeePercent = number(finance.customerServiceFeePercent, SYSTEM_DEFAULTS.customerServiceFeePercent);
  const customerServiceFeeFlat = number(finance.customerServiceFeeFlat, SYSTEM_DEFAULTS.customerServiceFeeFlat, 0, 1000000000);
  const customerTaxPercent = number(finance.customerTaxPercent, SYSTEM_DEFAULTS.customerTaxPercent);
  const holdMinutes = number(finance.holdMinutes, SYSTEM_DEFAULTS.holdMinutes, 1, 180);
  const supportedCurrencies = currencies(row.supportedCurrencies, defaultCurrency);
  return {
    platformName: String(row.platformName || SYSTEM_DEFAULTS.platformName).trim(),
    defaultCurrency,
    supportedCurrencies,
    partnerCommissionPercent,
    promoterSharePercent,
    partnerPayoutPercent: Math.max(0, 100 - partnerCommissionPercent),
    promoterEffectivePercent: Number(((partnerCommissionPercent * promoterSharePercent) / 100).toFixed(4)),
    customerServiceFeePercent,
    customerServiceFeeFlat,
    customerTaxPercent,
    holdMinutes,
    commercialTermsVersion: String(finance.commercialTermsVersion || SYSTEM_DEFAULTS.commercialTermsVersion).trim() || SYSTEM_DEFAULTS.commercialTermsVersion,
    supportEmail: String(row.supportEmail || '').trim(),
    supportMessage: String(finance.supportMessage || row.supportMessage || SYSTEM_DEFAULTS.supportMessage).trim(),
    maintenanceMode: row.maintenanceMode === true,
  };
}

function toStored(config) {
  return {
    platformName: config.platformName,
    supportedCurrencies: config.supportedCurrencies,
    supportEmail: config.supportEmail,
    supportMessage: config.supportMessage,
    maintenanceMode: config.maintenanceMode,
    financeRules: {
      partnerCommissionPercent: config.partnerCommissionPercent,
      promoterSharePercent: config.promoterSharePercent,
      customerServiceFeePercent: config.customerServiceFeePercent,
      customerServiceFeeFlat: config.customerServiceFeeFlat,
      customerTaxPercent: config.customerTaxPercent,
      holdMinutes: config.holdMinutes,
      defaultCurrency: config.defaultCurrency,
      commercialTermsVersion: config.commercialTermsVersion,
      supportMessage: config.supportMessage,
    },
  };
}

function copy(config) {
  return { ...config, supportedCurrencies: [...config.supportedCurrencies] };
}

async function ensurePlatformConfig() {
  const existing = await platformSettingsRepository.get();
  const config = normalize(existing);
  // Always rewrite legacy subscription/split configuration into the canonical
  // commission-only shape. Mongoose strict mode removes retired plan fields.
  await platformSettingsRepository.save(toStored(config));
  await platformSettingsRepository.removeRetiredCommercialFields();
  cached = config;
  return copy(config);
}

async function getPlatformConfig({ refresh = false } = {}) {
  if (refresh) return ensurePlatformConfig();
  const existing = await platformSettingsRepository.get();
  cached = normalize(existing);
  return copy(cached);
}

function getCachedPlatformConfig() {
  return copy(cached);
}

async function savePlatformConfig(input = {}) {
  const current = await getPlatformConfig();
  const next = normalize({
    ...toStored(current),
    ...input,
    financeRules: { ...toStored(current).financeRules, ...(input.financeRules || {}) },
  });
  await platformSettingsRepository.save(toStored(next));
  await platformSettingsRepository.removeRetiredCommercialFields();
  cached = next;
  return getCachedPlatformConfig();
}

module.exports = {
  SYSTEM_DEFAULTS,
  normalize,
  ensurePlatformConfig,
  getPlatformConfig,
  getCachedPlatformConfig,
  savePlatformConfig,
};

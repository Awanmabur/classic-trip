'use strict';

const { getCachedPlatformConfig } = require('../services/platform/platformConfigService');
const commercialTermsService = require('../services/commission/commercialTermsService');

function bounded(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : fallback;
}

function normalizeRates(overrides = {}) {
  const config = getCachedPlatformConfig();
  return {
    partnerCommissionPercent: bounded(overrides.partnerCommissionPercent ?? overrides.commissionPercent, config.partnerCommissionPercent),
    promoterSharePercent: bounded(overrides.promoterSharePercent, config.promoterSharePercent),
    promoterFixedAmount: Math.max(0, Number(overrides.promoterFixedAmount ?? overrides.promoterFixedUgx ?? config.promoterFixedAmount ?? config.promoterFixedUgx ?? 0) || 0),
    promoterRewardModel: overrides.promoterRewardModel || config.promoterRewardModel || (Number(config.promoterFixedAmount ?? config.promoterFixedUgx ?? 0) > 0 ? 'fixed_amount' : 'none'),
    currency: String(overrides.currency || config.defaultCurrency).trim().toUpperCase(),
  };
}

module.exports = function calculateCommission(total, hasValidReferral = false, rateOverrides = {}) {
  const rates = normalizeRates(rateOverrides);
  const terms = {
    model: 'percentage_commission',
    commissionPercent: rates.partnerCommissionPercent,
    currency: rates.currency,
    promoterRewardModel: rates.promoterRewardModel,
    promoterFixedAmount: rates.promoterFixedAmount,
    promoterSharePercent: rates.promoterSharePercent,
    customerDiscountModel: 'none',
    termsVersion: rateOverrides.termsVersion || 'legacy-percentage-wrapper',
    source: 'legacy_percentage_wrapper',
  };
  return commercialTermsService.calculateCommercialSplit({
    grossAmount: total,
    units: 1,
    hasReferral: hasValidReferral,
    terms,
    currency: rates.currency,
  });
};

module.exports.normalizeRates = normalizeRates;

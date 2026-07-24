'use strict';

const { getCachedPlatformConfig } = require('../services/platform/platformConfigService');

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function bounded(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : fallback;
}

function normalizeRates(overrides = {}) {
  const config = getCachedPlatformConfig();
  const partnerCommissionPercent = bounded(
    overrides.partnerCommissionPercent ?? overrides.commissionPercent,
    config.partnerCommissionPercent,
  );
  const promoterSharePercent = bounded(
    overrides.promoterSharePercent,
    config.promoterSharePercent,
  );
  return {
    partnerCommissionPercent,
    promoterSharePercent,
    partnerPayoutPercent: Math.max(0, 100 - partnerCommissionPercent),
  };
}

module.exports = function calculateCommission(total, hasValidReferral = false, rateOverrides = {}) {
  const amount = roundMoney(Math.max(0, Number(total) || 0));
  const rates = normalizeRates(rateOverrides);
  const totalCommission = roundMoney((amount * rates.partnerCommissionPercent) / 100);
  const promoterAmount = hasValidReferral
    ? roundMoney((totalCommission * rates.promoterSharePercent) / 100)
    : 0;
  const platformFee = roundMoney(Math.max(0, totalCommission - promoterAmount));
  const companyAmount = roundMoney(Math.max(0, amount - totalCommission));
  return {
    commercialModel: 'percentage_commission',
    partnerCommissionPercent: rates.partnerCommissionPercent,
    promoterSharePercent: hasValidReferral ? rates.promoterSharePercent : 0,
    partnerPayoutPercent: rates.partnerPayoutPercent,
    promoterEffectivePercent: amount > 0 ? roundMoney((promoterAmount / amount) * 100) : 0,
    platformNetPercent: amount > 0 ? roundMoney((platformFee / amount) * 100) : 0,
    totalCommission,
    platformFee,
    promoterAmount,
    companyAmount,
  };
};

module.exports.normalizeRates = normalizeRates;

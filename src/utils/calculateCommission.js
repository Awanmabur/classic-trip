const { env } = require('../config/env');

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function activeRates() {
  const defaults = {
    platform: env.commission.platform,
    promoter: env.commission.promoter,
    platformWithPromoter: env.commission.platformWithPromoter,
    company: env.commission.company,
  };
  let rules;
  try {
    // Lazy require: persistentStore.js requires this module at load time, so a top-level
    // require here would create a circular dependency and see an empty module.exports.
    rules = require('../services/data/persistentStore').state?.platformSettings?.financeRules;
  } catch (error) {
    rules = null;
  }
  if (!rules) return defaults;
  const platform = Number(rules.platformFeePercent);
  const promoter = Number(rules.promoterCommissionPercent);
  const company = Number(rules.partnerPayoutPercent);
  const hasPlatform = Number.isFinite(platform) && platform >= 0;
  const hasPromoter = Number.isFinite(promoter) && promoter >= 0;
  return {
    platform: hasPlatform ? platform : defaults.platform,
    promoter: hasPromoter ? promoter : defaults.promoter,
    platformWithPromoter: hasPlatform && hasPromoter ? Math.max(0, platform - promoter) : defaults.platformWithPromoter,
    company: Number.isFinite(company) && company >= 0 ? company : defaults.company,
  };
}

module.exports = function calculateCommission(total, hasValidReferral = false) {
  const amount = Number(total) || 0;
  const rates = activeRates();
  const platformRate = hasValidReferral ? rates.platformWithPromoter : rates.platform;
  const promoterRate = hasValidReferral ? rates.promoter : 0;
  const companyRate = rates.company;
  return {
    platformRate,
    promoterRate,
    companyRate,
    platformFee: roundMoney((amount * platformRate) / 100),
    promoterAmount: roundMoney((amount * promoterRate) / 100),
    companyAmount: roundMoney((amount * companyRate) / 100),
  };
};

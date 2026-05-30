const { env } = require('../config/env');

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

module.exports = function calculateCommission(total, hasValidReferral = false) {
  const amount = Number(total) || 0;
  const platformRate = hasValidReferral ? env.commission.platformWithPromoter : env.commission.platform;
  const promoterRate = hasValidReferral ? env.commission.promoter : 0;
  const companyRate = env.commission.company;
  return {
    platformRate,
    promoterRate,
    companyRate,
    platformFee: roundMoney((amount * platformRate) / 100),
    promoterAmount: roundMoney((amount * promoterRate) / 100),
    companyAmount: roundMoney((amount * companyRate) / 100),
  };
};

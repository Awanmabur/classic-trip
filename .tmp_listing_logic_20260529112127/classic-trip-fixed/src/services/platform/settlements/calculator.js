const {
  PROMOTER_COMMISSION,
  PLATFORM_WITH_PROMOTER_COMMISSION,
  PLATFORM_COMMISSION
} = require("../../../config/app");

const PROMOTER_PERCENT = PROMOTER_COMMISSION;
const PLATFORM_PERCENT_WITH_PROMOTER = PLATFORM_WITH_PROMOTER_COMMISSION;
const PLATFORM_PERCENT_WITHOUT_PROMOTER = PLATFORM_COMMISSION;

function calculateSettlement(grossAmount, hasPromoter) {
  const roundedGross = Math.max(0, Number(grossAmount || 0));
  const promoterPercent = hasPromoter ? PROMOTER_PERCENT : 0;
  const platformPercent = hasPromoter ? PLATFORM_PERCENT_WITH_PROMOTER : PLATFORM_PERCENT_WITHOUT_PROMOTER;

  const promoterAmount = Math.round((roundedGross * promoterPercent) / 100);
  const platformAmount = Math.round((roundedGross * platformPercent) / 100);
  const ownerAmount = Math.max(0, roundedGross - promoterAmount - platformAmount);

  return {
    grossAmount: roundedGross,
    promoterPercent,
    promoterAmount,
    platformPercent,
    platformAmount,
    ownerPercent: roundedGross ? Number(((ownerAmount / roundedGross) * 100).toFixed(2)) : 0,
    ownerAmount
  };
}

module.exports = {
  PROMOTER_PERCENT,
  PLATFORM_PERCENT_WITH_PROMOTER,
  PLATFORM_PERCENT_WITHOUT_PROMOTER,
  calculateSettlement
};

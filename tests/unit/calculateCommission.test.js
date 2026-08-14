const calculateCommission = require('../../src/utils/calculateCommission');

test('legacy percentage wrapper splits money without referral using explicit agreement rate', () => {
  const split = calculateCommission(100000, false, { commissionPercent: 10, promoterRewardModel: 'none' });
  expect(split.platformFee).toBe(10000);
  expect(split.promoterAmount).toBe(0);
  expect(split.companyAmount).toBe(90000);
});

test('legacy wrapper promoter reward is explicit, not a hard-coded platform amount', () => {
  const split = calculateCommission(100000, true, { commissionPercent: 10, promoterRewardModel: 'fixed_amount', promoterFixedAmount: 2000 });
  expect(split.platformFee).toBe(8000);
  expect(split.promoterAmount).toBe(2000);
  expect(split.promoterRewardModel).toBe('fixed_amount');
  expect(split.companyAmount).toBe(90000);
});

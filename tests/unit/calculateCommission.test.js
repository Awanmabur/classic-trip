const calculateCommission = require('../../src/utils/calculateCommission');

test('splits money without referral', () => {
  const split = calculateCommission(100000, false);
  expect(split.platformFee).toBe(10000);
  expect(split.promoterAmount).toBe(0);
  expect(split.companyAmount).toBe(90000);
});

test('splits money with referral', () => {
  const split = calculateCommission(100000, true);
  expect(split.platformFee).toBe(8000);
  expect(split.promoterAmount).toBe(2000);
  expect(split.companyAmount).toBe(90000);
  expect(split.promoterRewardModel).toBe('fixed_ugx');
});

const calculateCommission = require('../../src/utils/calculateCommission');

test('splits money without referral', () => {
  const split = calculateCommission(100000, false);
  expect(split.platformFee).toBe(10000);
  expect(split.promoterAmount).toBe(0);
  expect(split.companyAmount).toBe(90000);
});

test('splits money with referral', () => {
  const split = calculateCommission(100000, true);
  expect(split.platformFee).toBe(7000);
  expect(split.promoterAmount).toBe(3000);
  expect(split.companyAmount).toBe(90000);
});

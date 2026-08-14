const { test, expect } = global;
const { serviceFeeForTicket, priceBusTicket } = require('../../src/utils/busCustomerPricing');

test('bus ticket pricing has no hard-coded route discount', () => {
  const row = priceBusTicket({ partnerFare: 50000, currency: 'UGX' });
  expect(row.partnerTicketAmount).toBe(50000);
  expect(row.customerFare).toBe(50000);
  expect(row.discount).toBe(0);
});

test('bus ticket pricing applies only the agreement discount supplied by the server', () => {
  const row = priceBusTicket({ partnerFare: 50000, discountAmount: 3000, currency: 'UGX' });
  expect(row.partnerTicketAmount).toBe(50000);
  expect(row.customerFare).toBe(47000);
  expect(row.discount).toBe(3000);
});

test('ticket customer fee follows platform configuration rather than UGX tiers', () => {
  expect(serviceFeeForTicket(50000, 'UGX')).toBe(0);
  expect(serviceFeeForTicket(50000, 'KES')).toBe(0);
});

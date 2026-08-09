const { test, expect } = global;
const { serviceFeeForTicket, priceBusTicket } = require('../../src/utils/busCustomerPricing');

test('UGX service fee tiers are continuous', () => {
  expect(serviceFeeForTicket(1000, 'UGX')).toBe(1000);
  expect(serviceFeeForTicket(30000, 'UGX')).toBe(1000);
  expect(serviceFeeForTicket(30001, 'UGX')).toBe(2000);
  expect(serviceFeeForTicket(100000, 'UGX')).toBe(2000);
  expect(serviceFeeForTicket(100001, 'UGX')).toBe(3000);
  expect(serviceFeeForTicket(150000, 'UGX')).toBe(3000);
  expect(serviceFeeForTicket(150001, 'UGX')).toBe(5000);
});

test('full published route receives customer acquisition discount', () => {
  expect(priceBusTicket({ partnerFare: 50000, isMainRoute: true, currency: 'UGX' })).toEqual({
    partnerTicketAmount: 50000,
    customerFare: 47000,
    discount: 3000,
    serviceFee: 2000,
    customerTotal: 49000,
    isMainRoute: true,
    currency: 'UGX',
  });
});

test('intermediate journey keeps partner fare and gets no route discount', () => {
  const row = priceBusTicket({ partnerFare: 50000, isMainRoute: false, currency: 'UGX' });
  expect(row.customerFare).toBe(50000);
  expect(row.discount).toBe(0);
  expect(row.serviceFee).toBe(2000);
});

test('discount can lower the service-fee tier', () => {
  const row = priceBusTicket({ partnerFare: 31000, isMainRoute: true, currency: 'UGX' });
  expect(row.customerFare).toBe(28000);
  expect(row.serviceFee).toBe(1000);
  expect(row.customerTotal).toBe(29000);
});

test('UGX-only policy leaves other currencies unchanged', () => {
  const row = priceBusTicket({ partnerFare: 50000, isMainRoute: true, currency: 'KES' });
  expect(row.customerFare).toBe(50000);
  expect(row.discount).toBe(0);
  expect(row.serviceFee).toBe(0);
});

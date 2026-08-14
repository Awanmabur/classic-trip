const commercialTermsService = require('../../src/services/commission/commercialTermsService');

test('fixed per Standard ticket protects partner payout', () => {
  const split = commercialTermsService.calculateAgreementComponent({
    grossAmount: 50000,
    terms: { model: 'fixed_per_unit', fixedAmount: 5000, unitBasis: 'per_ticket', currency: 'UGX', promoterRewardModel: 'none', customerDiscountModel: 'none' },
    counts: { ticketCount: 1 },
    currency: 'UGX',
  });
  expect(split.platformGrossCommission).toBe(5000);
  expect(split.companyAmount).toBe(45000);
  expect(split.customerFare).toBe(50000);
});

test('fixed per VIP ticket scales by ticket count', () => {
  const split = commercialTermsService.calculateAgreementComponent({
    grossAmount: 120000,
    terms: { model: 'fixed_per_unit', fixedAmount: 10000, unitBasis: 'per_ticket', currency: 'UGX' },
    counts: { ticketCount: 2 },
    currency: 'UGX',
  });
  expect(split.units).toBe(2);
  expect(split.platformGrossCommission).toBe(20000);
  expect(split.companyAmount).toBe(100000);
});

test('customer discount and promoter reward come only from Classic Trip share', () => {
  const split = commercialTermsService.calculateAgreementComponent({
    grossAmount: 50000,
    terms: {
      model: 'fixed_per_unit', fixedAmount: 5000, unitBasis: 'per_ticket', currency: 'UGX',
      customerDiscountModel: 'fixed_amount', customerDiscountFixedAmount: 2000,
      promoterRewardModel: 'fixed_amount', promoterFixedAmount: 1000,
    },
    counts: { ticketCount: 1 }, hasReferral: true, currency: 'UGX',
  });
  expect(split.companyAmount).toBe(45000);
  expect(split.discountAmount).toBe(2000);
  expect(split.promoterAmount).toBe(1000);
  expect(split.platformCommissionFee).toBe(2000);
  expect(split.customerFare).toBe(48000);
});

test('percentage agreement can allocate promoter and discount percentages from platform share', () => {
  const split = commercialTermsService.calculateAgreementComponent({
    grossAmount: 100000,
    terms: {
      model: 'percentage_commission', commissionPercent: 10, currency: 'UGX',
      customerDiscountModel: 'percentage_of_platform', customerDiscountSharePercent: 20,
      promoterRewardModel: 'percentage_of_platform', promoterSharePercent: 25,
    },
    counts: { bookingCount: 1 }, hasReferral: true, currency: 'UGX',
  });
  expect(split.platformGrossCommission).toBe(10000);
  expect(split.companyAmount).toBe(90000);
  expect(split.discountAmount).toBe(2000);
  expect(split.promoterAmount).toBe(2500);
  expect(split.platformCommissionFee).toBe(5500);
  expect(split.customerFare).toBe(98000);
});

test('allocations are capped and can never reduce the partner payout', () => {
  const split = commercialTermsService.calculateAgreementComponent({
    grossAmount: 20000,
    terms: {
      model: 'fixed_per_unit', fixedAmount: 5000, unitBasis: 'per_ticket',
      customerDiscountModel: 'fixed_amount', customerDiscountFixedAmount: 4000,
      promoterRewardModel: 'fixed_amount', promoterFixedAmount: 10000,
    },
    counts: { ticketCount: 1 }, hasReferral: true, currency: 'UGX',
  });
  expect(split.companyAmount).toBe(15000);
  expect(split.discountAmount).toBe(4000);
  expect(split.promoterAmount).toBe(1000);
  expect(split.platformCommissionFee).toBe(0);
});

test('fare-plan rule overrides listing and partner rule', () => {
  const terms = commercialTermsService.resolveTerms({
    company: { id: 'c1', commercialTerms: { model: 'percentage_commission', commissionPercent: 10, termsVersion: 'company-1' } },
    listing: { id: 'l1', commercialTermsOverride: { model: 'percentage_commission', commissionPercent: 8, termsVersion: 'listing-1' } },
    fareProduct: { id: 'f-vip', commercialTermsOverride: { model: 'fixed_per_unit', fixedAmount: 10000, unitBasis: 'per_ticket', termsVersion: 'vip-1' } },
  });
  expect(terms.model).toBe('fixed_per_unit');
  expect(terms.fixedAmount).toBe(10000);
  expect(terms.unitBasis).toBe('per_ticket');
  expect(terms.scopeType).toBe('fare_product');
});

test('room-type rule can use fixed amount per room-night', () => {
  const terms = commercialTermsService.resolveTerms({
    company: { id: 'h1', commercialTerms: { model: 'percentage_commission', commissionPercent: 12, termsVersion: 'hotel-company' } },
    listing: { id: 'hotel1' },
    roomType: { id: 'suite', commercialTermsOverride: { model: 'fixed_per_unit', fixedAmount: 7000, unitBasis: 'per_room_night', termsVersion: 'suite-v1' } },
  });
  const split = commercialTermsService.calculateAgreementComponent({ grossAmount: 300000, terms, counts: { roomCount: 2, roomNightCount: 4 }, currency: 'UGX' });
  expect(split.units).toBe(4);
  expect(split.platformGrossCommission).toBe(28000);
  expect(split.companyAmount).toBe(272000);
});

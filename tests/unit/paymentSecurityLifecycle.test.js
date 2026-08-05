'use strict';

const {
  assertPaymentAccess,
  scopedIdempotencyKey: travelKey,
} = require('../../src/services/payment/travelDomainPaymentService');
const {
  assertBookingOwner,
  scopedIdempotencyKey: bookingKey,
} = require('../../src/services/payment/bookingPaymentService');
const {
  assertAmountAndCurrency,
  webhookTransitionAllowed,
  paymentStateApplied,
  groupPaymentStateApplied,
  webhookIdempotencyKey,
} = require('../../src/services/payment/webhookService');
const { safePaymentRedirect } = require('../../src/utils/paymentRedirect');

describe('payment ownership and lifecycle security', () => {
  const booking = {
    id: 'booking-1',
    bookingRef: 'CT-FLIGHT-1',
    companyId: 'supplier-1',
    agentCompanyId: 'agent-1',
    customerUserId: 'customer-1',
    guestLookupCode: 'private-code',
    paymentStatus: 'pending',
    pricing: { total: 125000, currency: 'UGX' },
  };

  test('travel payment access accepts only the owning customer, tenant or lookup code', () => {
    expect(assertPaymentAccess(booking, {}, { userId: 'customer-1' })).toBe(true);
    expect(assertPaymentAccess(booking, {}, { companyId: 'agent-1' })).toBe(true);
    expect(assertPaymentAccess(booking, { lookupCode: 'private-code' }, { id: 'guest' })).toBe(true);
    expect(() => assertPaymentAccess(booking, { lookupCode: 'wrong' }, { id: 'guest' })).toThrow();
    expect(() => assertPaymentAccess(booking, {}, { companyId: 'other-company' })).toThrow();
  });

  test('generic payment access is tenant and customer scoped', () => {
    expect(assertBookingOwner(booking, { id: 'customer-1', role: 'customer' })).toBe(true);
    expect(assertBookingOwner(booking, { companyId: 'supplier-1', role: 'company_admin' })).toBe(true);
    expect(assertBookingOwner(booking, { role: 'super_admin' })).toBe(true);
    expect(() => assertBookingOwner(booking, { id: 'other-user', role: 'customer' })).toThrow();
    expect(assertBookingOwner(booking, { accessGranted: true, bookingRef: booking.bookingRef })).toBe(true);
    expect(() => assertBookingOwner(booking, { accessGranted: true, bookingRef: 'CT-OTHER' })).toThrow();
  });

  test('provider checkout redirects reject unsafe schemes and embedded credentials', () => {
    expect(safePaymentRedirect('https://pay.example.test/checkout?id=1')).toBe('https://pay.example.test/checkout?id=1');
    expect(safePaymentRedirect('javascript:alert(1)', '/tickets')).toBe('/tickets');
    expect(safePaymentRedirect('https://user:pass@pay.example.test/order', '/tickets')).toBe('/tickets');
  });

  test('idempotency keys are scoped to both provider and booking', () => {
    expect(travelKey('pesapal', 'CT-1', 'request-1')).not.toBe(travelKey('pesapal', 'CT-2', 'request-1'));
    expect(bookingKey('paystack', 'CT-1', 'request-1')).not.toBe(bookingKey('paystack', 'CT-2', 'request-1'));
    expect(webhookIdempotencyKey({ provider: 'paystack', idempotencyKey: 'event-1' }, 'CT-1'))
      .not.toBe(webhookIdempotencyKey({ provider: 'flutterwave', idempotencyKey: 'event-1' }, 'CT-1'));
  });

  test('successful webhooks require exact amount and currency', () => {
    expect(() => assertAmountAndCurrency(booking, {
      status: 'successful', amount: 125000, amountProvided: true, currency: 'UGX', currencyProvided: true,
    }, 'booking')).not.toThrow();
    expect(() => assertAmountAndCurrency(booking, {
      status: 'successful', amount: 125000, amountProvided: true, currency: 'UGX', currencyProvided: false,
    }, 'booking')).toThrow();
    expect(() => assertAmountAndCurrency(booking, {
      status: 'successful', amount: 1, amountProvided: true, currency: 'UGX', currencyProvided: true,
    }, 'booking')).toThrow();
  });

  test('webhook state transitions never downgrade paid or refunded records', () => {
    expect(webhookTransitionAllowed({ paymentStatus: 'successful' }, 'pending')).toBe(false);
    expect(webhookTransitionAllowed({ paymentStatus: 'successful' }, 'failed')).toBe(false);
    expect(webhookTransitionAllowed({ paymentStatus: 'successful' }, 'refunded')).toBe(true);
    expect(webhookTransitionAllowed({ paymentStatus: 'refunded' }, 'successful')).toBe(false);
  });

  test('idempotent webhook replays are complete only after child state is applied', () => {
    expect(paymentStateApplied({ paymentStatus: 'successful' }, 'successful')).toBe(true);
    expect(paymentStateApplied({ paymentStatus: 'pending' }, 'successful')).toBe(false);
    expect(groupPaymentStateApplied(
      { paymentStatus: 'successful' },
      [{ paymentStatus: 'successful' }, { paymentStatus: 'pending' }],
      'successful',
    )).toBe(false);
  });
});

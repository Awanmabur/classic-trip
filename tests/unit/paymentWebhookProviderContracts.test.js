const crypto = require('crypto');
const { signatureForProvider } = require('../../src/services/payment/httpPaymentProvider');
const { normalizeProviderPayload, assertRefundAmountAndCurrency } = require('../../src/services/payment/webhookService');
const { minorAmount } = require('../../src/services/payment/httpPaymentProvider');

test('normalizes provider webhook payloads into Classic Trip booking fields', () => {
  const normalized = normalizeProviderPayload({
    provider: 'paystack',
    event: 'charge.success',
    data: {
      reference: 'PSK-100',
      amount: 125000,
      currency: 'KES',
      status: 'success',
      metadata: { bookingRef: 'CT-BUS-TEST' },
    },
  });
  expect(normalized.provider).toBe('paystack');
  expect(normalized.bookingRef).toBe('CT-BUS-TEST');
  expect(normalized.providerReference).toBe('PSK-100');
  expect(normalized.amount).toBe(1250);
  expect(normalized.status).toBe('successful');
});

test('verifies Paystack against raw-body sha512 contract', () => {
  const raw = JSON.stringify({ event: 'charge.success', data: { reference: 'PSK-101' } });
  const secret = 'paystack-secret';
  const signature = crypto.createHmac('sha512', secret).update(raw).digest('hex');
  const result = signatureForProvider('paystack', JSON.parse(raw), { webhookSecret: secret }, { 'x-paystack-signature': signature, __rawBody: raw });
  expect(result.configured).toBe(true);
  expect(result.valid).toBe(true);
});

test('verifies Flutterwave direct verif-hash and rejects tampering', () => {
  const payload = { event: 'charge.completed', data: { tx_ref: 'CT-BUS-TEST', status: 'successful' } };
  const ok = signatureForProvider('flutterwave', payload, { webhookSecret: 'flw-secret' }, { 'verif-hash': 'flw-secret', __rawBody: JSON.stringify(payload) });
  const bad = signatureForProvider('flutterwave', payload, { webhookSecret: 'flw-secret' }, { 'verif-hash': 'wrong-secret', __rawBody: JSON.stringify(payload) });
  expect(ok.valid).toBe(true);
  expect(bad.valid).toBe(false);
});

test('refund failure events remain distinct from original payment failures', () => {
  const normalized = normalizeProviderPayload({
    provider: 'paystack',
    event: 'refund.failed',
    data: {
      id: 9901,
      amount: 75000,
      currency: 'UGX',
      status: 'failed',
      transaction: { reference: 'PSK-ORIGINAL-100' },
      metadata: { bookingRef: 'CT-BUS-REFUND' },
    },
  });
  expect(normalized.refundLifecycleStatus).toBe('failed');
  expect(normalized.status).toBe('failed');
  expect(normalized.providerReference).toBe('PSK-ORIGINAL-100');
  expect(normalized.providerRefundReference).toBe(9901);
  expect(normalized.bookingRef).toBe('CT-BUS-REFUND');
});

test('completed refund events use the approved refund amount and provider minor units', () => {
  const normalized = normalizeProviderPayload({
    provider: 'paystack',
    event: 'refund.processed',
    data: {
      id: 9902,
      amount: 750000,
      currency: 'NGN',
      status: 'processed',
      transaction: { reference: 'PSK-ORIGINAL-101' },
      metadata: { bookingRef: 'CT-BUS-REFUND-2' },
    },
  });
  expect(normalized.refundLifecycleStatus).toBe('completed');
  expect(normalized.status).toBe('refunded');
  expect(normalized.amount).toBe(7500);
  expect(minorAmount(7500, 'NGN')).toBe(750000);
  expect(minorAmount(7500, 'XOF')).toBe(750000);
  expect(() => assertRefundAmountAndCurrency({ amount: 7500, currency: 'NGN' }, normalized)).not.toThrow();
  expect(() => assertRefundAmountAndCurrency({ amount: 7600, currency: 'NGN' }, normalized)).toThrow(/does not match/);
});

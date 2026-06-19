const crypto = require('crypto');
const { signatureForProvider } = require('../../src/services/payment/httpPaymentProvider');
const { normalizeProviderPayload } = require('../../src/services/payment/webhookService');

test('normalizes provider webhook payloads into Classic Trip booking fields', () => {
  const normalized = normalizeProviderPayload({
    provider: 'paystack',
    event: 'charge.success',
    data: {
      reference: 'PSK-100',
      amount: 125000,
      currency: 'UGX',
      status: 'success',
      metadata: { bookingRef: 'CT-BUS-TEST' },
    },
  });
  expect(normalized.provider).toBe('paystack');
  expect(normalized.bookingRef).toBe('CT-BUS-TEST');
  expect(normalized.providerReference).toBe('PSK-100');
  expect(normalized.amount).toBe(125000);
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

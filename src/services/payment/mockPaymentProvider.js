const generateCode = require('../../utils/generateCode');

async function initiatePayment({ amount, currency = 'UGX', customer, bookingRef }) {
  return {
    provider: 'mock',
    providerReference: generateCode('MOCKPAY', 10),
    amount,
    currency,
    status: 'successful',
    paidAt: new Date().toISOString(),
    rawPayload: { bookingRef, customer, message: 'Mock payment automatically confirmed in development.' },
  };
}

async function initiateRefund({ amount, currency = 'UGX', bookingRef, refundId, originalProviderReference }) {
  return {
    provider: 'mock',
    refundReference: generateCode('MOCKREF', 10),
    amount,
    currency,
    status: 'successful',
    refundedAt: new Date().toISOString(),
    rawPayload: { bookingRef, refundId, originalProviderReference, message: 'Mock refund automatically confirmed in development.' },
  };
}

async function verifyWebhook(payload) {
  return { valid: true, status: payload.status || 'successful', payload };
}

module.exports = { initiatePayment, initiateRefund, verifyWebhook };

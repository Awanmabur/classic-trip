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

async function verifyWebhook(payload) {
  return { valid: true, status: payload.status || 'successful', payload };
}

module.exports = { initiatePayment, verifyWebhook };

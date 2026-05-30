const mockProvider = require('./mockPaymentProvider');

async function initiatePayment(payment) {
  return mockProvider.initiatePayment(payment);
}

async function handleWebhook(payload) {
  return mockProvider.verifyWebhook(payload);
}

module.exports = { initiatePayment, handleWebhook };

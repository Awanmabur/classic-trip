const mockProvider = require('./mockPaymentProvider');
const { createProvider } = require('./httpPaymentProvider');
const { env } = require('../../config/env');

const supportedProviders = ['mock', 'mtn_momo', 'airtel_money', 'flutterwave', 'paystack', 'dpo'];

function providerFor(name = env.paymentProvider) {
  const provider = supportedProviders.includes(name) ? name : 'mock';
  if (provider === 'mock') return mockProvider;
  return createProvider(provider, env.paymentProviders[provider] || {});
}

async function initiatePayment(payment) {
  return providerFor(payment.provider || env.paymentProvider).initiatePayment(payment);
}

async function handleWebhook(payload) {
  return providerFor(payload.provider || env.paymentProvider).verifyWebhook(payload);
}

function providerSummary() {
  return supportedProviders.map((provider) => ({
    provider,
    active: provider === env.paymentProvider,
    configured: provider === 'mock' || Boolean(env.paymentProviders[provider]?.apiUrl && env.paymentProviders[provider]?.apiKey),
  }));
}

module.exports = { initiatePayment, handleWebhook, providerSummary, supportedProviders };

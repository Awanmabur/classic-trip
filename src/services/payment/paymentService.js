const mockProvider = require('./mockPaymentProvider');
const { createProvider } = require('./httpPaymentProvider');
const pesapalProvider = require('./pesapalPaymentProvider');
const { env } = require('../../config/env');

const supportedProviders = ['mock', 'pesapal', 'mtn_momo', 'airtel_money', 'flutterwave', 'paystack', 'dpo'];

function normalizeProviderName(name = env.paymentProvider) {
  return String(name || env.paymentProvider || 'mock').trim().toLowerCase().replace(/-/g, '_');
}

function providerConfig(provider) {
  return env.paymentProviders[provider] || {};
}

function providerIsConfigured(provider) {
  if (provider === 'mock') return Boolean(env.allowMockPayments);
  const config = providerConfig(provider);
  if (provider === 'pesapal') return pesapalProvider.configured(config);
  return Boolean(config.apiUrl && config.apiKey);
}

function assertProviderAllowed(name, options = {}) {
  const provider = normalizeProviderName(name);
  if (!supportedProviders.includes(provider)) {
    const error = new Error(`Unsupported payment provider: ${name || provider}`);
    error.status = 422;
    throw error;
  }
  if (provider === 'mock' && !env.allowMockPayments) {
    const error = new Error('Mock payments are disabled for this environment');
    error.status = 403;
    throw error;
  }
  if (!options.allowUnconfigured && provider !== 'mock' && !providerIsConfigured(provider)) {
    const error = new Error(`${provider} payment provider is not configured`);
    error.status = 503;
    throw error;
  }
  return provider;
}

function providerFor(name = env.paymentProvider, options = {}) {
  const provider = assertProviderAllowed(name, options);
  if (provider === 'mock') return mockProvider;
  if (provider === 'pesapal') {
    const config = providerConfig(provider);
    return {
      provider,
      configured: pesapalProvider.configured(config),
      initiatePayment: (payment) => pesapalProvider.initiatePayment(payment, config),
      verifyWebhook: (payload) => pesapalProvider.verifyWebhook(payload, config),
    };
  }
  return createProvider(provider, providerConfig(provider));
}

function resolveProviderName(name = env.paymentProvider) {
  return assertProviderAllowed(name, { allowUnconfigured: true });
}

async function initiatePayment(payment = {}) {
  const provider = providerFor(payment.provider || env.paymentProvider);
  return provider.initiatePayment({ ...payment, provider: provider.provider || payment.provider || env.paymentProvider });
}

async function handleWebhook(payload = {}) {
  const provider = providerFor(payload.provider || env.paymentProvider, { allowUnconfigured: false });
  return provider.verifyWebhook(payload);
}

async function initiateRefund(refund = {}) {
  const provider = providerFor(refund.provider || env.paymentProvider);
  if (typeof provider.initiateRefund !== 'function') return { status: 'not_supported', provider: refund.provider || env.paymentProvider };
  return provider.initiateRefund(refund);
}

function providerSummary() {
  return supportedProviders.map((provider) => ({
    provider,
    active: provider === normalizeProviderName(env.paymentProvider),
    configured: providerIsConfigured(provider),
    mockOnly: provider === 'mock',
    enabled: provider !== 'mock' || Boolean(env.allowMockPayments),
  }));
}

module.exports = {
  initiatePayment,
  initiateRefund,
  handleWebhook,
  providerSummary,
  supportedProviders,
  providerFor,
  resolveProviderName,
  assertProviderAllowed,
};
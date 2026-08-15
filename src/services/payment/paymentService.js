const { createProvider } = require('./httpPaymentProvider');
const pesapalProvider = require('./pesapalPaymentProvider');
const { env } = require('../../config/env');
const { safePaymentRedirect } = require('../../utils/paymentRedirect');
const logger = require('../../config/logger');

let providerWarmTimer = null;
let providerWarmLogged = false;

const supportedProviders = ['pesapal', 'mtn_momo', 'airtel_money', 'flutterwave', 'paystack', 'dpo'];

function normalizeProviderName(name = env.paymentProvider) {
  return String(name || env.paymentProvider || 'pesapal').trim().toLowerCase().replace(/-/g, '_');
}

function providerConfig(provider) {
  return env.paymentProviders[provider] || {};
}

function providerIsConfigured(provider) {
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
  if (!options.allowUnconfigured && !providerIsConfigured(provider)) {
    const error = new Error(`${provider} payment provider is not configured`);
    error.status = 503;
    throw error;
  }
  return provider;
}

function providerFor(name = env.paymentProvider, options = {}) {
  const provider = assertProviderAllowed(name, options);
  if (provider === 'pesapal') {
    const config = providerConfig(provider);
    return {
      provider,
      configured: pesapalProvider.configured(config),
      initiatePayment: (payment) => pesapalProvider.initiatePayment(payment, config),
      initiateRefund: (refund) => pesapalProvider.initiateRefund(refund, config),
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
  const result = await provider.initiatePayment({ ...payment, provider: provider.provider || payment.provider || env.paymentProvider });
  return {
    ...result,
    checkoutUrl: safePaymentRedirect(result?.checkoutUrl, ''),
  };
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


async function prewarmActiveProvider() {
  const provider = normalizeProviderName(env.paymentProvider);
  if (provider !== 'pesapal' || !providerIsConfigured(provider)) return { provider, configured: providerIsConfigured(provider), warmed: false };
  const config = providerConfig(provider);
  const notificationReady = env.isProduction || /^https:\/\//i.test(String(config.ipnUrl || ''));
  const result = await pesapalProvider.prewarm(config, { notification: notificationReady });
  return { provider, configured: true, warmed: true, ...result };
}

function startProviderKeepWarm() {
  if (providerWarmTimer) return providerWarmTimer;
  const run = () => prewarmActiveProvider()
    .then((result) => {
      if (!result.warmed) return;
      if (!providerWarmLogged) { logger.info('Payment provider control plane warmed', { provider: result.provider }); providerWarmLogged = true; }
      else logger.debug('Payment provider control plane refreshed', { provider: result.provider });
    })
    .catch((error) => logger.warn('Payment provider warmup deferred; checkout will retry on demand', { provider: env.paymentProvider, error: error.message }));
  run();
  // Pesapal documents a maximum 5-minute bearer-token lifetime. Refresh the
  // process cache every four minutes so a normal payment click usually needs
  // only SubmitOrderRequest, not authentication + IPN discovery first.
  providerWarmTimer = setInterval(run, 4 * 60 * 1000);
  providerWarmTimer.unref?.();
  return providerWarmTimer;
}

function stopProviderKeepWarm() {
  if (providerWarmTimer) clearInterval(providerWarmTimer);
  providerWarmTimer = null;
  providerWarmLogged = false;
}
function providerSummary() {
  return supportedProviders.map((provider) => ({
    provider,
    active: provider === normalizeProviderName(env.paymentProvider),
    configured: providerIsConfigured(provider),
    enabled: true,
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
  prewarmActiveProvider,
  startProviderKeepWarm,
  stopProviderKeepWarm,
};

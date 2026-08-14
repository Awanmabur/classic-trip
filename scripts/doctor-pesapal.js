#!/usr/bin/env node
'use strict';
require('dotenv').config();
const { env } = require('../src/config/env');
const pesapal = require('../src/services/payment/pesapalPaymentProvider');

function fail(message) { console.error(`✗ ${message}`); process.exitCode = 1; }
(async () => {
  console.log('Classic Trip Pesapal go-live doctor\n');
  if (env.paymentProvider !== 'pesapal') return fail(`PAYMENT_PROVIDER is ${env.paymentProvider}; expected pesapal for this doctor.`);
  const config = env.paymentProviders.pesapal;
  if (!pesapal.configured(config)) return fail('Pesapal credentials are missing. Set PESAPAL_CONSUMER_KEY and PESAPAL_CONSUMER_SECRET.');
  let appUrl;
  let callback;
  let ipn;
  try {
    appUrl = new URL(env.appUrl);
    callback = new URL(config.callbackUrl);
    ipn = config.ipnUrl ? new URL(config.ipnUrl) : null;
  } catch (error) { return fail(error.message); }
  const live = new URL(config.apiUrl).hostname.toLowerCase() === 'pay.pesapal.com';
  const localHost = ['localhost', '127.0.0.1', '::1'].includes(appUrl.hostname.toLowerCase());
  const strictProductionUrls = env.isProduction || process.argv.includes('--production');
  if (live && localHost && !strictProductionUrls) {
    try {
      const result = await pesapal.credentialCheck(config);
      console.log(`✓ Pesapal authentication accepted — ${result.apiHost}`);
      console.log(`✓ Pesapal control plane reachable — ${result.activeIpnCount} active IPN registration(s) visible`);
      console.log('! Local development detected: localhost cannot receive a live Pesapal callback/IPN.');
      console.log('! Run `npm run doctor:pesapal -- --production` on the deployed HTTPS environment to certify callback/IPN readiness.');
      console.log('\n✓ Local Pesapal credential check passed. No customer charge was created.');
      return;
    } catch (error) {
      return fail(`${error.message}${error.providerResponse ? ` — ${JSON.stringify(error.providerResponse)}` : ''}`);
    }
  }
  if (live) {
    if (appUrl.protocol !== 'https:') return fail('Live Pesapal requires APP_URL to use HTTPS.');
    if (callback.protocol !== 'https:' || callback.hostname.toLowerCase() !== appUrl.hostname.toLowerCase()) return fail('PESAPAL_CALLBACK_URL must use HTTPS on the APP_URL host.');
    if (ipn && (ipn.protocol !== 'https:' || ipn.hostname.toLowerCase() !== appUrl.hostname.toLowerCase())) return fail('PESAPAL_IPN_URL must use HTTPS on the APP_URL host.');
  }
  try {
    const result = await pesapal.readinessCheck(config);
    console.log(`✓ Pesapal authentication accepted — ${result.apiHost}`);
    console.log(`✓ Pesapal IPN active — ${result.notificationId} (${result.notificationType})`);
    console.log(`✓ Callback — ${result.callbackUrl}`);
    console.log(`✓ IPN URL — ${result.ipnUrl}`);
    console.log('\n✓ Pesapal control-plane readiness passed. No customer charge was created by this doctor.');
  } catch (error) {
    fail(`${error.message}${error.providerResponse ? ` — ${JSON.stringify(error.providerResponse)}` : ''}`);
  }
})().catch((error) => fail(error.stack || error.message));

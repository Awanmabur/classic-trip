#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const p = require('../src/services/payment/pesapalPaymentProvider');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
let passed = 0;
function check(label, fn) {
  return Promise.resolve().then(fn).then(() => { passed += 1; console.log(`✓ ${label}`); }).catch((e) => { console.error(`✗ ${label}: ${e.message}`); process.exitCode = 1; });
}
(async () => {
  const config = {
    apiUrl: 'https://pay.pesapal.com/v3/api', consumerKey: 'go-live-key', consumerSecret: 'go-live-secret',
    callbackUrl: 'https://www.classictrip.org/booking/payment/callback', ipnUrl: 'https://www.classictrip.org/api/webhooks/payments', notificationType: 'POST',
  };
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    const u = String(url); const body = options.body ? JSON.parse(options.body) : null; calls.push({ u, method: options.method || 'GET', body });
    let payload;
    if (u.includes('/Auth/RequestToken')) payload = { token: 'go-live-token', expiryDate: new Date(Date.now() + 3600000).toISOString() };
    else if (u.includes('/URLSetup/GetIpnList')) payload = [{ ipn_id: 'IPN-LIVE-1', url: config.ipnUrl, ipn_notification_type_description: 'POST', ipn_status: 1 }];
    else if (u.includes('/Transactions/SubmitOrderRequest')) payload = { order_tracking_id: 'TRACK-LIVE-1', merchant_reference: body.id, redirect_url: 'https://pay.pesapal.com/pay/checkout-1', status: '200' };
    else if (u.includes('/Transactions/GetTransactionStatus')) payload = { order_tracking_id: 'TRACK-LIVE-1', merchant_reference: 'CTS-LIVE-1', payment_status_description: 'Completed', amount: 25000, currency: 'UGX', confirmation_code: 'CONF-1' };
    else throw new Error(`Unexpected Pesapal URL ${u}`);
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
  };
  try {
    await check('Pesapal live endpoint is the official API 3.0 host', () => assert.strictEqual(new URL(config.apiUrl).hostname, 'pay.pesapal.com'));
    await check('control-plane readiness authenticates and verifies active IPN', async () => {
      const r = await p.readinessCheck(config); assert.strictEqual(r.authenticated, true); assert.strictEqual(r.notificationId, 'IPN-LIVE-1'); assert.strictEqual(r.notificationType, 'POST');
    });
    await check('order initiation sends callback, notification id and customer billing data', async () => {
      const result = await p.initiatePayment({ bookingRef: 'CTS-LIVE-1', amount: 25000, currency: 'UGX', description: 'Classic Trip go-live payment contract', customer: { fullName: 'Launch Test', phone: '+256700000001' } }, config);
      assert.strictEqual(result.providerReference, 'TRACK-LIVE-1'); assert.ok(result.checkoutUrl.startsWith('https://pay.pesapal.com/'));
      const submit = calls.find((c) => c.u.includes('/Transactions/SubmitOrderRequest')); assert(submit); assert.strictEqual(submit.body.notification_id, 'IPN-LIVE-1'); assert.strictEqual(submit.body.callback_url, config.callbackUrl); assert.strictEqual(submit.body.id, 'CTS-LIVE-1'); assert(submit.body.billing_address.phone_number);
    });
    await check('IPN verification trusts GetTransactionStatus rather than callback merchant reference', async () => {
      const verified = await p.verifyWebhook({ OrderTrackingId: 'TRACK-LIVE-1', OrderMerchantReference: 'ATTACKER-REF' }, config);
      assert.strictEqual(verified.valid, true); assert.strictEqual(verified.bookingRef, 'CTS-LIVE-1'); assert.strictEqual(verified.amount, 25000); assert.strictEqual(verified.currency, 'UGX'); assert.strictEqual(verified.status, 'successful');
    });
    await check('public callback and webhook routes are both wired', () => {
      const publicRoutes = read('src/routes/web/public.js'); const webhookRoutes = read('src/routes/api/webhooks.js');
      assert(publicRoutes.includes("router.get('/booking/payment/callback'"));
      assert(webhookRoutes.includes("router.get('/payments'")); assert(webhookRoutes.includes("router.post('/payments'"));
    });
    await check('Pesapal IPN response shape echoes required tracking/reference fields', () => {
      const controller = read('src/controllers/api/paymentController.js');
      assert(controller.includes('orderNotificationType')); assert(controller.includes('orderTrackingId')); assert(controller.includes('orderMerchantReference')); assert(controller.includes('status: 200'));
    });
    await check('production env pins live Pesapal and same-host HTTPS callbacks', () => {
      const env = read('src/config/env.js'); assert(env.includes("hostname.toLowerCase() !== 'pay.pesapal.com'")); assert(env.includes('PESAPAL_CALLBACK_URL must use HTTPS on the APP_URL host')); assert(env.includes('PESAPAL_IPN_URL must use HTTPS on the APP_URL host'));
    });
    await check('doctor:pesapal performs non-charge authentication/IPN readiness', () => {
      const doctor = read('scripts/doctor-pesapal.js'); assert(doctor.includes('readinessCheck(config)')); assert(doctor.includes('No customer charge was created'));
    });
  } finally { global.fetch = originalFetch; }
  if (!process.exitCode) console.log(`\n${passed}/${passed} Pesapal go-live checks passed.`);
})().catch((error) => { global.fetch = originalFetch; console.error(error); process.exit(1); });

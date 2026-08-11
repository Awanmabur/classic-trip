'use strict';
const assert = require('assert');
const p = require('../src/services/payment/pesapalPaymentProvider');

(async () => {
  assert.strictEqual(p.safeMerchantReference('CTB-ABC_123:4.5'), 'CTB-ABC_123:4.5');
  assert.throws(() => p.safeMerchantReference('bad ref with spaces'), /merchant reference/i);
  assert.throws(() => p.safeMerchantReference('X'.repeat(51)), /50 characters/i);
  assert.throws(() => p.assertPesapalRedirect('https://evil.example/pay', { apiUrl:'https://pay.pesapal.com/v3/api' }), /unexpected checkout host/i);
  assert.ok(p.assertPesapalRedirect('https://pay.pesapal.com/pay/abc', { apiUrl:'https://pay.pesapal.com/v3/api' }).startsWith('https://pay.pesapal.com/'));
  const order = p.buildOrder({ bookingRef:'CTB-ABC123', currency:'UGX', amount:50000, description:'x'.repeat(160), customer:{ phone:'+256781977217', fullName:'Test Passenger' } }, { callbackUrl:'https://www.classictrip.org/booking/payment/callback', apiUrl:'https://pay.pesapal.com/v3/api' }, 'ipn-id');
  assert.strictEqual(order.id, 'CTB-ABC123');
  assert.strictEqual(order.description.length, 100);
  assert.strictEqual(order.amount, 50000);
  assert.strictEqual(order.callback_url, 'https://www.classictrip.org/booking/payment/callback');
  assert.throws(() => p.buildOrder({ bookingRef:'CTB-A', currency:'UGX', amount:0, customer:{ phone:'+256700000000' } }, { callbackUrl:'https://www.classictrip.org/booking/payment/callback', apiUrl:'https://pay.pesapal.com/v3/api' }, 'x'), /greater than zero/i);
  assert.throws(() => p.buildOrder({ bookingRef:'CTB-A', currency:'UGX', amount:1000, customer:{} }, { callbackUrl:'https://www.classictrip.org/booking/payment/callback', apiUrl:'https://pay.pesapal.com/v3/api' }, 'x'), /email address or phone/i);

  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async (url) => {
    calls += 1;
    const u = String(url);
    const payload = u.includes('/Auth/RequestToken')
      ? { token:'test-token', expiryDate:new Date(Date.now()+5*60*1000).toISOString() }
      : { order_tracking_id:'TRACK-1', merchant_reference:'CTB-REAL', payment_status_description:'Completed', amount:49000, currency:'UGX' };
    return { ok:true, status:200, json:async()=>payload, text:async()=>JSON.stringify(payload) };
  };
  const verified = await p.verifyWebhook({ OrderTrackingId:'TRACK-1', OrderMerchantReference:'CTB-ATTACKER' }, { apiUrl:'https://pay.pesapal.com/v3/api', consumerKey:'key', consumerSecret:'secret' });
  assert.strictEqual(verified.bookingRef, 'CTB-REAL');
  assert.strictEqual(verified.amount, 49000);
  assert.strictEqual(verified.currency, 'UGX');
  assert.strictEqual(verified.status, 'successful');
  assert.ok(calls >= 2);
  global.fetch = originalFetch;
  console.log('Pesapal provider security unit checks passed (16/16).');
})().catch((error) => { console.error(error); process.exit(1); });

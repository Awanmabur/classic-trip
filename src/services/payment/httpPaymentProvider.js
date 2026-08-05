const { platformCurrency } = require('../../utils/currency');
function configured(config = {}) {
  return Boolean(config.apiUrl && config.apiKey);
}

async function postJson(url, apiKey, payload, extraHeaders = {}) {
  if (typeof fetch !== 'function') {
    const error = new Error('Global fetch is unavailable in this Node runtime');
    error.status = 500;
    throw error;
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
  });
  let body = null;
  try { body = await response.json(); } catch (error) { body = await response.text(); }
  if (!response.ok) {
    const error = new Error(`Payment provider request failed with status ${response.status}`);
    error.status = 502;
    error.providerResponse = body;
    throw error;
  }
  return body;
}


function hmac(payload, secret, algorithm = 'sha256') {
  return require('crypto').createHmac(algorithm, secret).update(typeof payload === 'string' ? payload : JSON.stringify(payload)).digest('hex');
}

function hmacSha256(payload, secret) {
  return hmac(payload, secret, 'sha256');
}

function headerValue(headers = {}, names = []) {
  const lower = Object.fromEntries(Object.entries(headers || {}).map(([key, value]) => [String(key).toLowerCase(), value]));
  for (const name of names) {
    const value = lower[String(name).toLowerCase()];
    if (value) return String(value).replace(/^sha256=/, '').trim();
  }
  return '';
}

function safeEqual(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue || '').replace(/^sha256=/, '').trim());
  const right = Buffer.from(String(rightValue || '').replace(/^sha256=/, '').trim());
  return left.length === right.length && require('crypto').timingSafeEqual(left, right);
}

function signatureForProvider(provider, payload, config = {}, headers = {}) {
  if (!config.webhookSecret) return { configured: false, valid: false, reason: 'Provider webhook secret is not configured' };
  const rawBody = headers.__rawBody || '';
  const bodyForHmac = rawBody || JSON.stringify(payload || {});
  const normalizedProvider = String(provider || '').toLowerCase();

  if (normalizedProvider === 'paystack') {
    const supplied = headerValue(headers, ['x-paystack-signature']);
    if (!supplied) return { configured: true, valid: false, reason: 'Paystack signature header missing' };
    return { configured: true, valid: safeEqual(hmac(bodyForHmac, config.webhookSecret, 'sha512'), supplied), reason: 'Paystack signature mismatch' };
  }

  if (normalizedProvider === 'flutterwave') {
    const supplied = headerValue(headers, ['verif-hash', 'x-flutterwave-signature']);
    if (!supplied) return { configured: true, valid: false, reason: 'Flutterwave signature header missing' };
    const directSecretMatch = safeEqual(config.webhookSecret, supplied);
    const hmacMatch = safeEqual(hmacSha256(bodyForHmac, config.webhookSecret), supplied);
    return { configured: true, valid: directSecretMatch || hmacMatch, reason: 'Flutterwave signature mismatch' };
  }

  const supplied = headerValue(headers, [
    'x-payment-signature',
    'x-provider-signature',
    'x-momo-signature',
    'x-airtel-signature',
    'x-dpo-signature',
  ]);
  if (!supplied) return { configured: true, valid: false, reason: 'Provider signature header missing' };
  return { configured: true, valid: safeEqual(hmacSha256(bodyForHmac, config.webhookSecret), supplied), reason: 'Provider signature mismatch' };
}

function normalizeStatus(value = '') {
  const status = String(value || '').toLowerCase();
  if (['success', 'successful', 'succeeded', 'paid', 'completed', 'approved', 'processed', 'refunded', 'reversed'].includes(status)) return 'successful';
  if (['fail', 'failed', 'declined', 'cancelled', 'canceled'].includes(status)) return 'failed';
  if (['pending', 'processing', 'queued'].includes(status)) return 'pending';
  return status || 'pending';
}

function minorAmount(amount, currency = '') {
  // Paystack expects amounts in currency subunits, including XOF where its API
  // contract still requires a x100 representation even though ISO has no minor unit.
  return Math.round(Number(amount || 0) * 100);
}

const PAYSTACK_CURRENCIES = new Set(['NGN', 'USD', 'GHS', 'ZAR', 'KES', 'XOF']);

function assertPaystackCurrency(currency = '') {
  const normalized = String(currency || '').toUpperCase();
  if (!PAYSTACK_CURRENCIES.has(normalized)) {
    const error = new Error(`Paystack does not support ${normalized || 'the selected currency'} for this integration`);
    error.status = 422;
    error.code = 'paystack_currency_not_supported';
    throw error;
  }
  return normalized;
}

function createProvider(provider, config = {}) {
  return {
    provider,
    configured: configured(config),
    async initiatePayment(payment = {}) {
      if (!configured(config)) {
        const error = new Error(`${provider} payment provider is not configured`);
        error.status = 503;
        throw error;
      }
      const customer = payment.customer || { name: payment.fullName, email: payment.email, phone: payment.phone };
      const currency = String(payment.currency || platformCurrency()).toUpperCase();
      const payload = provider === 'paystack'
        ? {
          email: customer.email,
          amount: minorAmount(payment.amount, assertPaystackCurrency(currency)),
          currency,
          reference: payment.bookingRef || payment.idempotencyKey,
          callback_url: payment.callbackUrl || config.callbackUrl,
          metadata: { bookingRef: payment.bookingRef, customerName: customer.name || '', customerPhone: customer.phone || '', ...(payment.meta || {}) },
        }
        : {
          provider,
          bookingRef: payment.bookingRef,
          amount: Number(payment.amount || 0),
          currency,
          customer,
          callbackUrl: payment.callbackUrl || config.callbackUrl,
          meta: payment.meta || {},
        };
      const result = await postJson(config.apiUrl, config.apiKey, payload, payment.idempotencyKey ? { 'Idempotency-Key': payment.idempotencyKey } : {});
      const responseData = result?.data || {};
      return {
        provider,
        providerReference: result.providerReference || result.reference || result.id || result.tx_ref || responseData.reference || (provider === 'flutterwave' ? responseData.id : '') || '',
        checkoutUrl: result.checkoutUrl || result.authorizationUrl || result.link || result.data?.authorization_url || '',
        amount: Number(result.amount || payment.amount || 0),
        currency: result.currency || currency,
        status: normalizeStatus(responseData.status || result.status),
        paidAt: normalizeStatus(responseData.status || result.status) === 'successful' ? new Date().toISOString() : null,
        rawPayload: result,
      };
    },
    async verifyWebhook(payload = {}) {
      return {
        valid: true,
        provider,
        status: normalizeStatus(payload.status || payload.data?.status),
        payload,
      };
    },
    async initiateRefund(refund = {}) {
      if (!config.refundUrl) {
        const error = new Error(`${provider} refund endpoint is not configured`);
        error.status = 503;
        error.code = 'provider_refund_not_configured';
        throw error;
      }
      if (!refund.providerReference || !(Number(refund.amount) > 0)) {
        const error = new Error('Refund requires a provider transaction reference and positive amount');
        error.status = 422;
        throw error;
      }
      const idempotencyKey = String(refund.idempotencyKey || `refund:${refund.refundId || refund.providerReference}`).slice(0, 255);
      let payload;
      let headers = { 'Idempotency-Key': idempotencyKey };
      if (provider === 'paystack') {
        const currency = assertPaystackCurrency(refund.currency);
        payload = { transaction: refund.providerReference, amount: minorAmount(refund.amount, currency), currency, merchant_note: refund.reason || 'Classic Trip approved refund' };
      } else if (provider === 'flutterwave') {
        payload = { charge_id: refund.providerReference, amount: Number(refund.amount), reason: 'requested_by_customer', meta: { refundId: refund.refundId, bookingRef: refund.bookingRef } };
        headers = { 'X-Idempotency-Key': idempotencyKey, 'X-Trace-Id': idempotencyKey };
      } else {
        payload = { provider, transactionReference: refund.providerReference, amount: Number(refund.amount), currency: refund.currency, reason: refund.reason, idempotencyKey, refundId: refund.refundId, bookingRef: refund.bookingRef };
      }
      const result = await postJson(config.refundUrl, config.apiKey, payload, headers);
      if (result?.status === false) {
        const error = new Error(result.message || `${provider} rejected the refund request`);
        error.status = 409;
        error.providerResponse = result;
        throw error;
      }
      const data = result?.data || result || {};
      const rawRefundStatus = String(data.status || result.status || 'pending').toLowerCase();
      const refundStatus = provider === 'flutterwave' && rawRefundStatus === 'completed'
        ? 'pending'
        : normalizeStatus(rawRefundStatus);
      return {
        accepted: true,
        provider,
        status: refundStatus,
        providerRefundReference: data.refund_reference || data.reference || data.id || result.reference || '',
        rawPayload: result,
      };
    },
  };
}

module.exports = { createProvider, signatureForProvider, normalizeStatus, minorAmount, assertPaystackCurrency };

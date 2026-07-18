function configured(config = {}) {
  return Boolean(config.apiUrl && config.apiKey);
}

async function postJson(url, apiKey, payload) {
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
  if (['success', 'successful', 'paid', 'completed', 'approved'].includes(status)) return 'successful';
  if (['fail', 'failed', 'declined', 'cancelled', 'canceled'].includes(status)) return 'failed';
  if (['pending', 'processing', 'queued'].includes(status)) return 'pending';
  return status || 'pending';
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
      const payload = {
        provider,
        bookingRef: payment.bookingRef,
        amount: Number(payment.amount || 0),
        currency: payment.currency || 'UGX',
        customer: payment.customer || {
          name: payment.fullName,
          email: payment.email,
          phone: payment.phone,
        },
        callbackUrl: payment.callbackUrl || config.callbackUrl,
        meta: payment.meta || {},
      };
      const result = await postJson(config.apiUrl, config.apiKey, payload);
      return {
        provider,
        providerReference: result.providerReference || result.reference || result.id || result.tx_ref || result.data?.reference || '',
        checkoutUrl: result.checkoutUrl || result.authorizationUrl || result.link || result.data?.authorization_url || '',
        amount: Number(result.amount || payload.amount),
        currency: result.currency || payload.currency,
        status: normalizeStatus(result.status || result.data?.status),
        paidAt: normalizeStatus(result.status || result.data?.status) === 'successful' ? new Date().toISOString() : null,
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
  };
}

module.exports = { createProvider, signatureForProvider, normalizeStatus };

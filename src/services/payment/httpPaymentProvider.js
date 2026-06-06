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
        callbackUrl: config.callbackUrl,
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

module.exports = { createProvider };

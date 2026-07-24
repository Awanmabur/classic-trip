function trimTrailingSlash(value = '') {
  return String(value || '').replace(/\/+$/, '');
}

function configured(config = {}) {
  return Boolean(config.apiUrl && config.consumerKey && config.consumerSecret);
}

function endpoint(config = {}, pathname = '') {
  const base = trimTrailingSlash(config.apiUrl || '');
  return `${base}/${String(pathname || '').replace(/^\/+/, '')}`;
}

function normalizeStatus(value = '') {
  const status = String(value || '').toLowerCase().replace(/[_-]/g, ' ').trim();
  if (['completed', 'success', 'successful', 'paid', 'payment completed'].includes(status)) return 'successful';
  if (['failed', 'invalid', 'declined', 'cancelled', 'canceled'].includes(status)) return 'failed';
  if (['reversed', 'refunded'].includes(status)) return 'refunded';
  return status || 'pending';
}

async function requestJson(config, pathname, { method = 'POST', token = '', body = null, query = null } = {}) {
  if (typeof fetch !== 'function') {
    const error = new Error('Global fetch is unavailable in this Node runtime');
    error.status = 500;
    throw error;
  }
  const url = new URL(endpoint(config, pathname));
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') url.searchParams.set(key, value);
  });
  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload = null;
  try { payload = await response.json(); } catch (error) { payload = await response.text(); }
  if (!response.ok) {
    const error = new Error(`Pesapal request failed with status ${response.status}`);
    error.status = 502;
    error.providerResponse = payload;
    throw error;
  }
  return payload;
}

let tokenCache = { key: '', token: '', expiresAt: 0 };

async function tokenFor(config = {}) {
  if (!configured(config)) {
    const error = new Error('Pesapal payment provider is not configured');
    error.status = 503;
    throw error;
  }
  const key = `${config.apiUrl}:${config.consumerKey}`;
  if (tokenCache.key === key && tokenCache.token && tokenCache.expiresAt > Date.now() + 60000) return tokenCache.token;
  const result = await requestJson(config, '/Auth/RequestToken', {
    body: { consumer_key: config.consumerKey, consumer_secret: config.consumerSecret },
  });
  const token = result.token || result.access_token || result.data?.token;
  if (!token) {
    const error = new Error('Pesapal token response did not include a token');
    error.status = 502;
    error.providerResponse = result;
    throw error;
  }
  const ttlSeconds = Number(result.expires_in || result.expiry || 300);
  tokenCache = { key, token, expiresAt: Date.now() + Math.max(120, ttlSeconds) * 1000 };
  return token;
}

async function notificationIdFor(config = {}, token = '') {
  if (config.ipnId) return config.ipnId;
  if (!config.ipnUrl) {
    const error = new Error('Pesapal IPN URL or IPN ID is required');
    error.status = 503;
    throw error;
  }
  const result = await requestJson(config, '/URLSetup/RegisterIPN', {
    token,
    body: {
      url: config.ipnUrl,
      ipn_notification_type: config.notificationType || 'POST',
    },
  });
  const ipnId = result.ipn_id || result.ipnId || result.notification_id || result.data?.ipn_id;
  if (!ipnId) {
    const error = new Error('Pesapal IPN registration response did not include an IPN ID');
    error.status = 502;
    error.providerResponse = result;
    throw error;
  }
  return ipnId;
}

function splitName(value = '') {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || 'Classic',
    middleName: parts.length > 2 ? parts.slice(1, -1).join(' ') : '',
    lastName: parts.length > 1 ? parts[parts.length - 1] : 'Trip',
  };
}

function buildOrder(payment = {}, config = {}, notificationId = '') {
  const customer = payment.customer || {};
  const name = splitName(customer.fullName || customer.name || payment.fullName || 'Classic Trip Guest');
  const bookingRef = payment.bookingRef || payment.orderRef || payment.idempotencyKey;
  return {
    id: bookingRef,
    currency: String(payment.currency || platformCurrency()).toUpperCase(),
    amount: Number(payment.amount || 0),
    description: payment.description || `Classic Trip booking ${bookingRef}`,
    callback_url: payment.callbackUrl || config.callbackUrl,
    notification_id: notificationId,
    billing_address: {
      email_address: customer.email || payment.email || '',
      phone_number: customer.phone || payment.phone || '',
      country_code: customer.countryCode || payment.countryCode || 'UG',
      first_name: name.firstName,
      middle_name: name.middleName,
      last_name: name.lastName,
      line_1: customer.address || payment.address || '',
      line_2: '',
      city: customer.city || payment.city || '',
      state: customer.state || '',
      postal_code: customer.postalCode || '',
      zip_code: customer.zipCode || customer.postalCode || '',
    },
  };
}

function pickFirst(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function pesapalFields(payload = {}) {
  const data = payload.data || payload.transaction || payload.payment || {};
  return {
    bookingRef: pickFirst(payload.OrderMerchantReference, payload.order_merchant_reference, payload.merchant_reference, payload.bookingRef, payload.orderRef, data.OrderMerchantReference, data.merchant_reference, data.bookingRef),
    providerReference: pickFirst(payload.OrderTrackingId, payload.order_tracking_id, payload.orderTrackingId, payload.providerReference, data.OrderTrackingId, data.order_tracking_id, data.orderTrackingId, data.providerReference),
    status: pickFirst(payload.payment_status_description, payload.paymentStatusDescription, payload.status, data.payment_status_description, data.paymentStatusDescription, data.status),
    amount: pickFirst(payload.amount, payload.payment_amount, data.amount, data.payment_amount),
    currency: pickFirst(payload.currency, payload.currency_code, data.currency, data.currency_code),
  };
}

async function initiatePayment(payment = {}, config = {}) {
  const token = await tokenFor(config);
  const notificationId = await notificationIdFor(config, token);
  const order = buildOrder(payment, config, notificationId);
  const result = await requestJson(config, '/Transactions/SubmitOrderRequest', { token, body: order });
  const status = normalizeStatus(result.status || result.payment_status_description || result.data?.status);
  return {
    provider: 'pesapal',
    providerReference: result.order_tracking_id || result.OrderTrackingId || result.orderTrackingId || result.data?.order_tracking_id || '',
    checkoutUrl: result.redirect_url || result.redirectUrl || result.checkoutUrl || result.data?.redirect_url || '',
    amount: Number(result.amount || order.amount),
    currency: result.currency || order.currency,
    status: status === 'pending' && (result.redirect_url || result.redirectUrl) ? 'pending' : status,
    paidAt: status === 'successful' ? new Date().toISOString() : null,
    rawPayload: result,
  };
}

async function verifyWebhook(payload = {}, config = {}) {
  const fields = pesapalFields(payload);
  if (!fields.providerReference || !configured(config)) return { valid: false, provider: 'pesapal', reason: 'Pesapal transaction status could not be verified', payload };
  const token = await tokenFor(config);
  const statusPayload = await requestJson(config, '/Transactions/GetTransactionStatus', {
    method: 'GET',
    token,
    query: { orderTrackingId: fields.providerReference },
  });
  const verified = pesapalFields(statusPayload);
  const status = normalizeStatus(verified.status || statusPayload.payment_status_description || statusPayload.status);
  return {
    valid: true,
    provider: 'pesapal',
    // Trust Pesapal's own GetTransactionStatus response for this OrderTrackingId over the
    // caller-supplied webhook body, otherwise an attacker can pay for booking A and confirm
    // booking B by forging OrderMerchantReference in the webhook payload.
    bookingRef: verified.bookingRef || statusPayload.merchant_reference || fields.bookingRef || '',
    providerReference: fields.providerReference,
    amount: Number(verified.amount || fields.amount || statusPayload.amount || 0),
    currency: String(verified.currency || fields.currency || statusPayload.currency || platformCurrency()).toUpperCase(),
    status,
    payload: { ...payload, statusPayload },
  };
}

module.exports = { configured, initiatePayment, verifyWebhook, normalizeStatus, pesapalFields };
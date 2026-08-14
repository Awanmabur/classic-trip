const { platformCurrency } = require('../../utils/currency');
const logger = require('../../config/logger');
const DEFAULT_PAYMENT_REQUEST_TIMEOUT_MS = 12000;

function requestTimeoutMs(config = {}) {
  const configured = Number(config.requestTimeoutMs || config.timeoutMs || 0);
  return Math.max(2500, Math.min(configured > 0 ? configured : DEFAULT_PAYMENT_REQUEST_TIMEOUT_MS, 20000));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_PAYMENT_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(`Pesapal did not respond within ${timeoutMs} ms`);
      timeoutError.status = 504;
      timeoutError.code = 'payment_provider_timeout';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

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

function safeMerchantReference(value = '') {
  const reference = String(value || '').trim();
  if (!reference) {
    const error = new Error('Pesapal merchant reference is required'); error.status = 422; throw error;
  }
  if (reference.length > 50 || !/^[A-Za-z0-9._:-]+$/.test(reference)) {
    const error = new Error('Pesapal merchant reference must be 50 characters or fewer and use only letters, numbers, dot, underscore, colon or dash');
    error.status = 422; throw error;
  }
  return reference;
}

function validatedAbsoluteUrl(value = '', label = 'URL', { requireHttps = false } = {}) {
  let parsed;
  try { parsed = new URL(String(value || '').trim()); } catch (error) { const err = new Error(`${label} must be a valid absolute URL`); err.status = 503; throw err; }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) { const err = new Error(`${label} is not allowed`); err.status = 503; throw err; }
  if (requireHttps && parsed.protocol !== 'https:') { const err = new Error(`${label} must use HTTPS for live Pesapal`); err.status = 503; throw err; }
  return parsed;
}

function isLivePesapal(config = {}) {
  try { return new URL(config.apiUrl).hostname.toLowerCase() === 'pay.pesapal.com'; } catch (error) { return false; }
}

function assertPesapalRedirect(value = '', config = {}) {
  const parsed = validatedAbsoluteUrl(value, 'Pesapal checkout URL', { requireHttps: true });
  const host = parsed.hostname.toLowerCase();
  if (!(host === 'pesapal.com' || host.endsWith('.pesapal.com'))) {
    const error = new Error('Pesapal returned an unexpected checkout host'); error.status = 502; throw error;
  }
  if (isLivePesapal(config) && host.includes('cybqa')) { const error = new Error('Live Pesapal returned a sandbox checkout URL'); error.status = 502; throw error; }
  return parsed.toString();
}

function tokenExpiryAt(result = {}) {
  const absolute = result.expiryDate || result.expiry_date || result.expires_at || result.expiresAt;
  if (absolute) { const parsed = Date.parse(absolute); if (Number.isFinite(parsed) && parsed > Date.now()) return parsed; }
  const ttl = Number(result.expires_in || result.expiry || 300);
  return Date.now() + Math.max(120, Number.isFinite(ttl) ? ttl : 300) * 1000;
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
  const response = await fetchWithTimeout(url, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  }, requestTimeoutMs(config));
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
let notificationCache = { key: '', ipnId: '', expiresAt: 0 };

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
  tokenCache = { key, token, expiresAt: tokenExpiryAt(result) };
  return token;
}

async function notificationIdFor(config = {}, token = '') {
  if (config.ipnId) return String(config.ipnId).trim();
  if (!config.ipnUrl) {
    const error = new Error('Pesapal IPN URL or IPN ID is required');
    error.status = 503;
    throw error;
  }
  const ipnUrl = validatedAbsoluteUrl(config.ipnUrl, 'Pesapal IPN URL', { requireHttps: isLivePesapal(config) }).toString();
  const notificationType = String(config.notificationType || 'POST').toUpperCase();
  if (!['GET', 'POST'].includes(notificationType)) { const error = new Error('PESAPAL_NOTIFICATION_TYPE must be GET or POST'); error.status = 503; throw error; }
  const key = `${config.apiUrl}:${ipnUrl}:${notificationType}`;
  if (notificationCache.key === key && notificationCache.ipnId && notificationCache.expiresAt > Date.now()) return notificationCache.ipnId;

  // Pesapal exposes GetIPNList. Reuse an already-registered active URL instead of
  // registering duplicates after every deploy/restart.
  try {
    const listed = await requestJson(config, '/URLSetup/GetIpnList', { method: 'GET', token });
    const rows = Array.isArray(listed) ? listed : (Array.isArray(listed?.data) ? listed.data : Array.isArray(listed?.ipn_list) ? listed.ipn_list : []);
    const match = rows.find((row) => {
      const sameUrl = String(row.url || '').replace(/\/$/, '') === ipnUrl.replace(/\/$/, '');
      const type = String(row.ipn_notification_type_description || row.notification_type_description || row.ipn_notification_type || '').toUpperCase();
      const active = row.ipn_status === undefined || row.ipn_status === 1 || row.ipn_status === '1' || String(row.ipn_status_description || row.ipn_status_decription || '').toLowerCase() === 'active';
      return sameUrl && active && (!type || type === notificationType);
    });
    const existingId = match && (match.ipn_id || match.ipnId || match.notification_id);
    if (existingId) {
      notificationCache = { key, ipnId: existingId, expiresAt: Date.now() + (24 * 60 * 60 * 1000) };
      return existingId;
    }
  } catch (error) {
    // Registration remains the authoritative fallback; a transient list failure
    // must not make checkout unavailable.
  }

  const result = await requestJson(config, '/URLSetup/RegisterIPN', {
    token,
    body: { url: ipnUrl, ipn_notification_type: notificationType },
  });
  const ipnId = result.ipn_id || result.ipnId || result.notification_id || result.data?.ipn_id;
  if (!ipnId) { const error = new Error('Pesapal IPN registration response did not include an IPN ID'); error.status = 502; error.providerResponse = result; throw error; }
  notificationCache = { key, ipnId, expiresAt: Date.now() + (24 * 60 * 60 * 1000) };
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
  const bookingRef = safeMerchantReference(payment.bookingRef || payment.orderRef || payment.idempotencyKey);
  const amount = Number(payment.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) { const error = new Error('Pesapal payment amount must be greater than zero'); error.status = 422; throw error; }
  const email = String(customer.email || payment.email || '').trim();
  const phone = String(customer.phone || payment.phone || '').trim();
  if (!email && !phone) { const error = new Error('Pesapal requires a customer email address or phone number'); error.status = 422; throw error; }
  const callback = validatedAbsoluteUrl(payment.callbackUrl || config.callbackUrl, 'Pesapal callback URL', { requireHttps: isLivePesapal(config) }).toString();
  return {
    id: bookingRef,
    currency: String(payment.currency || platformCurrency()).toUpperCase(),
    amount: Number(amount.toFixed(2)),
    description: String(payment.description || `Classic Trip booking ${bookingRef}`).trim().slice(0, 100),
    callback_url: callback,
    redirect_mode: 'TOP_WINDOW',
    cancellation_url: `${new URL(callback).origin}/tickets?bookingRef=${encodeURIComponent(bookingRef)}&paymentRetry=cancelled`,
    notification_id: notificationId,
    billing_address: {
      email_address: email,
      phone_number: phone,
      country_code: String(customer.countryCode || payment.countryCode || 'UG').trim().toUpperCase().slice(0, 2),
      first_name: name.firstName.slice(0, 50),
      middle_name: name.middleName.slice(0, 50),
      last_name: name.lastName.slice(0, 50),
      line_1: String(customer.address || payment.address || '').slice(0, 100),
      line_2: '',
      city: String(customer.city || payment.city || '').slice(0, 50),
      state: String(customer.state || '').slice(0, 50),
      postal_code: String(customer.postalCode || '').slice(0, 20),
      zip_code: String(customer.zipCode || customer.postalCode || '').slice(0, 20),
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


function ipnRows(payload) {
  return Array.isArray(payload) ? payload : (Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.ipn_list) ? payload.ipn_list : []);
}

function activeIpnRow(row = {}) {
  return row.ipn_status === undefined || row.ipn_status === 1 || row.ipn_status === '1' || String(row.ipn_status_description || row.ipn_status_decription || '').toLowerCase() === 'active';
}

async function credentialCheck(config = {}) {
  if (!configured(config)) {
    const error = new Error('Pesapal payment provider is not configured'); error.status = 503; throw error;
  }
  const live = isLivePesapal(config);
  const api = validatedAbsoluteUrl(config.apiUrl, 'Pesapal API URL', { requireHttps: live });
  if (live && api.hostname.toLowerCase() !== 'pay.pesapal.com') {
    const error = new Error('Live Pesapal API must use pay.pesapal.com'); error.status = 503; throw error;
  }
  const token = await tokenFor(config);
  const listed = await requestJson(config, '/URLSetup/GetIpnList', { method: 'GET', token });
  const rows = ipnRows(listed).filter(activeIpnRow);
  return { authenticated: true, provider: 'pesapal', live, apiHost: api.hostname, activeIpnCount: rows.length };
}

async function readinessCheck(config = {}) {
  if (!configured(config)) {
    const error = new Error('Pesapal payment provider is not configured'); error.status = 503; throw error;
  }
  const live = isLivePesapal(config);
  const api = validatedAbsoluteUrl(config.apiUrl, 'Pesapal API URL', { requireHttps: live });
  if (live && api.hostname.toLowerCase() !== 'pay.pesapal.com') {
    const error = new Error('Live Pesapal API must use pay.pesapal.com'); error.status = 503; throw error;
  }
  validatedAbsoluteUrl(config.callbackUrl, 'Pesapal callback URL', { requireHttps: live });
  if (config.ipnUrl) validatedAbsoluteUrl(config.ipnUrl, 'Pesapal IPN URL', { requireHttps: live });
  const token = await tokenFor(config);
  const notificationId = await notificationIdFor(config, token);
  const listed = await requestJson(config, '/URLSetup/GetIpnList', { method: 'GET', token });
  const rows = ipnRows(listed);
  const expectedUrl = String(config.ipnUrl || '').replace(/\/$/, '');
  const expectedType = String(config.notificationType || 'POST').toUpperCase();
  const match = rows.find((row) => {
    const rowId = String(row.ipn_id || row.ipnId || row.notification_id || '').trim();
    const rowUrl = String(row.url || '').replace(/\/$/, '');
    const rowType = String(row.ipn_notification_type_description || row.notification_type_description || row.ipn_notification_type || '').toUpperCase();
    return activeIpnRow(row)
      && (rowId === String(notificationId) || (expectedUrl && rowUrl === expectedUrl))
      && (!rowType || rowType === expectedType);
  });
  if (!match) {
    const error = new Error('Pesapal IPN is not visible as an active registration after authentication');
    error.status = 503; error.code = 'pesapal_ipn_not_active'; throw error;
  }
  return {
    authenticated: true,
    provider: 'pesapal',
    live,
    apiHost: api.hostname,
    notificationId: String(notificationId),
    notificationType: expectedType,
    ipnUrl: String(match.url || config.ipnUrl || ''),
    callbackUrl: String(config.callbackUrl || ''),
  };
}

async function prewarm(config = {}, options = {}) {
  if (!configured(config)) return { configured: false };
  const token = await tokenFor(config);
  const notificationId = options.notification === false ? '' : await notificationIdFor(config, token);
  return { configured: true, notificationId: String(notificationId || ''), tokenExpiresAt: tokenCache.expiresAt };
}

async function initiatePayment(payment = {}, config = {}) {
  const startedAt = Date.now();
  const token = await tokenFor(config);
  const notificationId = await notificationIdFor(config, token);
  const controlPlaneMs = Date.now() - startedAt;
  const order = buildOrder(payment, config, notificationId);
  const submitStartedAt = Date.now();
  let result;
  try {
    result = await requestJson(config, '/Transactions/SubmitOrderRequest', { token, body: order });
  } catch (error) {
    logger.warn('Pesapal SubmitOrderRequest timing', {
      bookingRef: String(payment.bookingRef || payment.reference || '').slice(0, 80),
      outcome: error?.code || 'error',
      controlPlaneMs,
      submitMs: Date.now() - submitStartedAt,
      timeoutMs: requestTimeoutMs(config),
      host: (() => { try { return new URL(config.apiUrl).hostname; } catch (_) { return ''; } })(),
    });
    throw error;
  }
  const submitMs = Date.now() - submitStartedAt;
  if (submitMs >= 1200) logger.warn('Pesapal SubmitOrderRequest timing', {
    bookingRef: String(payment.bookingRef || payment.reference || '').slice(0, 80),
    outcome: 'redirect_received', controlPlaneMs, submitMs, timeoutMs: requestTimeoutMs(config),
    host: (() => { try { return new URL(config.apiUrl).hostname; } catch (_) { return ''; } })(),
  });
  const status = normalizeStatus(result.status || result.payment_status_description || result.data?.status);
  const providerReference = String(result.order_tracking_id || result.OrderTrackingId || result.orderTrackingId || result.data?.order_tracking_id || '').trim();
  const rawCheckoutUrl = result.redirect_url || result.redirectUrl || result.checkoutUrl || result.data?.redirect_url || '';
  if (!providerReference || !rawCheckoutUrl) { const error = new Error('Pesapal order response is missing the tracking ID or checkout URL'); error.status = 502; error.providerResponse = result; throw error; }
  const checkoutUrl = assertPesapalRedirect(rawCheckoutUrl, config);
  return {
    provider: 'pesapal',
    providerReference,
    checkoutUrl,
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
  const verifiedBookingRef = String(verified.bookingRef || statusPayload.merchant_reference || '').trim();
  const verifiedAmountRaw = pickFirst(verified.amount, statusPayload.amount, statusPayload.payment_amount);
  const verifiedCurrencyRaw = pickFirst(verified.currency, statusPayload.currency, statusPayload.currency_code);
  const returnedTrackingId = String(pickFirst(statusPayload.order_tracking_id, statusPayload.OrderTrackingId, statusPayload.orderTrackingId) || '').trim();
  if (!verifiedBookingRef) {
    const error = new Error('Pesapal transaction status did not include the merchant reference'); error.status = 502; error.code = 'pesapal_status_reference_missing'; throw error;
  }
  if (returnedTrackingId && returnedTrackingId !== String(fields.providerReference)) {
    const error = new Error('Pesapal transaction status tracking reference does not match the requested transaction'); error.status = 502; error.code = 'pesapal_status_tracking_mismatch'; throw error;
  }
  if (status === 'successful' && (verifiedAmountRaw === undefined || verifiedCurrencyRaw === undefined)) {
    const error = new Error('Pesapal completed transaction status is missing amount or currency'); error.status = 502; error.code = 'pesapal_status_money_missing'; throw error;
  }
  return {
    valid: true,
    provider: 'pesapal',
    // Never fall back to the caller-supplied merchant reference. The reference,
    // amount and currency used to confirm a booking must come from Pesapal's own
    // GetTransactionStatus response for this OrderTrackingId.
    bookingRef: verifiedBookingRef,
    providerReference: fields.providerReference,
    amount: verifiedAmountRaw === undefined ? undefined : Number(verifiedAmountRaw),
    currency: verifiedCurrencyRaw === undefined ? undefined : String(verifiedCurrencyRaw).toUpperCase(),
    status,
    payload: { ...payload, statusPayload },
  };
}

async function initiateRefund(refund = {}, config = {}) {
  if (!refund.providerReference || !(Number(refund.amount) > 0)) {
    const error = new Error('Pesapal refund requires the original tracking reference and positive amount');
    error.status = 422;
    throw error;
  }
  const token = await tokenFor(config);
  let confirmationCode = String(refund.confirmationCode || '').trim();
  if (!confirmationCode) {
    const statusPayload = await requestJson(config, '/Transactions/GetTransactionStatus', {
      method: 'GET',
      token,
      query: { orderTrackingId: refund.providerReference },
    });
    confirmationCode = String(statusPayload.confirmation_code || statusPayload.confirmationCode || statusPayload.data?.confirmation_code || '').trim();
    if (normalizeStatus(statusPayload.payment_status_description || statusPayload.status) !== 'successful') {
      const error = new Error('Pesapal can refund only a completed payment');
      error.status = 409;
      throw error;
    }
    const originalAmount = Number(statusPayload.amount || statusPayload.payment_amount || statusPayload.data?.amount || 0);
    if (originalAmount > 0 && Number(refund.amount) > originalAmount + 0.01) {
      const error = new Error('Pesapal refund amount exceeds the completed payment');
      error.status = 409;
      throw error;
    }
    const paymentMethod = String(statusPayload.payment_method || statusPayload.payment_method_type || statusPayload.data?.payment_method || '').toLowerCase();
    if (/(mobile|momo|airtel|m-pesa|mpesa)/.test(paymentMethod) && originalAmount > 0 && Math.abs(Number(refund.amount) - originalAmount) > 0.01) {
      const error = new Error('Pesapal mobile-money payments can only be refunded in full');
      error.status = 409;
      throw error;
    }
  }
  if (!confirmationCode) {
    const error = new Error('Pesapal transaction status did not include the required confirmation code');
    error.status = 409;
    throw error;
  }
  const result = await requestJson(config, '/Transactions/RefundRequest', {
    token,
    body: {
      confirmation_code: confirmationCode,
      amount: Number(refund.amount).toFixed(2),
      username: String(refund.approvedBy || 'Classic Trip Finance').slice(0, 120),
      remarks: String(refund.reason || 'Classic Trip approved refund').slice(0, 500),
    },
  });
  if (String(result.error ?? result.status ?? '').trim() === '500') {
    const error = new Error(result.message || 'Pesapal rejected the refund request');
    error.status = 409;
    error.providerResponse = result;
    throw error;
  }
  return {
    accepted: true,
    provider: 'pesapal',
    status: normalizeStatus(result.status || result.message || 'pending'),
    providerRefundReference: result.refund_reference || result.reference || result.id || '',
    confirmationCode,
    rawPayload: result,
  };
}

module.exports = { configured, prewarm, initiatePayment, initiateRefund, verifyWebhook, readinessCheck, credentialCheck, normalizeStatus, pesapalFields, safeMerchantReference, assertPesapalRedirect, buildOrder, tokenExpiryAt };

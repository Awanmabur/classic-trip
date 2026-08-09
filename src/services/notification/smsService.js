const { env } = require('../../config/env');

function normalizePhone(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const plus = raw.startsWith('+');
  const digits = raw.replace(/[^\d]/g, '');
  return digits ? `${plus ? '+' : ''}${digits}` : '';
}

async function postJson(url, token, payload) {
  if (typeof fetch !== 'function') {
    return { ok: false, status: 0, body: { reason: 'Global fetch is unavailable in this Node runtime' } };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(env.sms.timeoutMs || 8000)));
  timeout.unref?.();
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  let body = null;
  try { body = await response.json(); } catch (error) { body = await response.text(); }
  return { ok: response.ok, status: response.status, body };
}

async function sendSms(message = {}) {
  const recipient = normalizePhone(message.to);
  if (!recipient) {
    return { status: 'skipped', channel: 'sms', provider: 'http', reason: 'Missing SMS recipient' };
  }
  if (!env.sms.apiUrl) {
    return { status: 'queued', channel: 'sms', provider: 'http', reason: 'SMS_API_URL is not configured', message };
  }

  const result = await postJson(env.sms.apiUrl, env.sms.apiToken, {
    to: recipient,
    from: env.sms.from,
    title: message.title,
    message: message.message,
    meta: message.meta || {},
  });

  return {
    status: result.ok ? 'sent' : 'failed',
    channel: 'sms',
    provider: 'http',
    providerStatus: result.status,
    response: result.body,
  };
}

module.exports = { sendSms };

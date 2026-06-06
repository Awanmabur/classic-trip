const { env } = require('../../config/env');

async function postJson(url, token, payload) {
  if (typeof fetch !== 'function') {
    return { ok: false, status: 0, body: { reason: 'Global fetch is unavailable in this Node runtime' } };
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  let body = null;
  try { body = await response.json(); } catch (error) { body = await response.text(); }
  return { ok: response.ok, status: response.status, body };
}

async function sendSms(message = {}) {
  if (!message.to) {
    return { status: 'skipped', channel: 'sms', provider: 'http', reason: 'Missing SMS recipient' };
  }
  if (!env.sms.apiUrl) {
    return { status: 'queued', channel: 'sms', provider: 'http', reason: 'SMS_API_URL is not configured', message };
  }

  const result = await postJson(env.sms.apiUrl, env.sms.apiToken, {
    to: message.to,
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

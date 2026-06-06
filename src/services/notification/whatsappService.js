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

async function sendWhatsapp(message = {}) {
  if (!message.to) {
    return { status: 'skipped', channel: 'whatsapp', provider: 'http', reason: 'Missing WhatsApp recipient' };
  }
  if (!env.whatsapp.apiUrl) {
    return { status: 'queued', channel: 'whatsapp', provider: 'http', reason: 'WHATSAPP_API_URL is not configured', message };
  }

  const result = await postJson(env.whatsapp.apiUrl, env.whatsapp.apiToken, {
    to: message.to,
    from: env.whatsapp.from,
    title: message.title,
    message: message.message,
    meta: message.meta || {},
  });

  return {
    status: result.ok ? 'sent' : 'failed',
    channel: 'whatsapp',
    provider: 'http',
    providerStatus: result.status,
    response: result.body,
  };
}

module.exports = { sendWhatsapp };

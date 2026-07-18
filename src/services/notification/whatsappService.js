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

function metaUrl() {
  if (env.whatsapp.apiUrl) return env.whatsapp.apiUrl;
  if (!env.whatsapp.phoneNumberId) return '';
  return `https://graph.facebook.com/${env.whatsapp.graphVersion}/${env.whatsapp.phoneNumberId}/messages`;
}

function payloadFor(message = {}) {
  if (env.whatsapp.provider === 'meta') {
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: String(message.to || '').replace(/^\+/, ''),
      type: 'text',
      text: {
        preview_url: true,
        body: [message.title, message.message].filter(Boolean).join('\n\n'),
      },
    };
  }
  return {
    to: message.to,
    from: env.whatsapp.from,
    title: message.title,
    message: message.message,
    meta: message.meta || {},
  };
}

async function sendWhatsapp(message = {}) {
  if (!message.to) {
    return { status: 'skipped', channel: 'whatsapp', provider: env.whatsapp.provider || 'http', reason: 'Missing WhatsApp recipient' };
  }
  const url = metaUrl();
  if (!url || !env.whatsapp.apiToken) {
    return { status: 'queued', channel: 'whatsapp', provider: env.whatsapp.provider || 'http', reason: 'WhatsApp API credentials are not configured', message };
  }

  const result = await postJson(url, env.whatsapp.apiToken, payloadFor(message));

  return {
    status: result.ok ? 'sent' : 'failed',
    channel: 'whatsapp',
    provider: env.whatsapp.provider || 'http',
    providerStatus: result.status,
    response: result.body,
  };
}

module.exports = { sendWhatsapp };
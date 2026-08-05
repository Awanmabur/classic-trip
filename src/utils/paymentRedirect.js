'use strict';

function safePaymentRedirect(value = '', fallback = '/tickets') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  try {
    const url = new URL(raw);
    const secure = url.protocol === 'https:';
    const localDevelopment = process.env.NODE_ENV !== 'production'
      && url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if ((!secure && !localDevelopment) || url.username || url.password) return fallback;
    return url.toString();
  } catch {
    return fallback;
  }
}

module.exports = { safePaymentRedirect };

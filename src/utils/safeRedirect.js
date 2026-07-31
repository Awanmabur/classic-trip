'use strict';

function safeRedirectPath(value, fallback = '/') {
  const candidate = String(value || '').trim();
  // Only a local absolute-path reference is accepted. Reject protocol-relative
  // URLs, backslash variants, control characters and malformed encoded input.
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.startsWith('/\\')) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(candidate)) return fallback;
  try {
    const decoded = decodeURIComponent(candidate);
    if (decoded.startsWith('//') || decoded.startsWith('/\\') || /[\u0000-\u001f\u007f\\]/.test(decoded)) return fallback;
  } catch (_) {
    return fallback;
  }
  return candidate;
}

module.exports = { safeRedirectPath };

'use strict';

function text(value) {
  return String(value == null ? '' : value).trim();
}

function safeImageUrl(value) {
  const candidate = text(value);
  if (!candidate) return '';
  if (candidate.startsWith('/') && !candidate.startsWith('//')) return candidate;
  if (/^https:\/\//i.test(candidate)) return candidate;
  if (process.env.NODE_ENV !== 'production' && /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\//i.test(candidate)) return candidate;
  return '';
}

function mediaObjectUrl(value) {
  if (!value || typeof value !== 'object') return '';
  for (const candidate of [value.secureUrl, value.secure_url, value.url, value.src, value.image, value.imageUrl]) {
    const resolved = safeImageUrl(candidate);
    if (resolved) return resolved;
  }
  return '';
}

function mediaUrl(value) {
  if (!value) return '';
  if (typeof value === 'string') return safeImageUrl(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const resolved = mediaUrl(item);
      if (resolved) return resolved;
    }
    return '';
  }
  return mediaObjectUrl(value);
}

function resolveMediaUrl(...candidates) {
  for (const candidate of candidates) {
    const resolved = mediaUrl(candidate);
    if (resolved) return resolved;
  }
  return '';
}

function isCloudinaryUrl(value) {
  const url = mediaUrl(value);
  if (!url) return false;
  try {
    const hostname = new URL(url, 'http://localhost').hostname.toLowerCase();
    return hostname === 'res.cloudinary.com' || hostname.endsWith('.cloudinary.com');
  } catch (_) {
    return false;
  }
}

module.exports = { safeImageUrl, mediaUrl, resolveMediaUrl, isCloudinaryUrl };

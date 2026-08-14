'use strict';

const REDACTED_KEYS = new Set([
  'password', 'passwordHash', 'passwordReset', 'emailVerifyToken',
  'phoneVerification', 'mfa', 'mfaSetup', 'secretEncrypted',
  'nationalIdEncrypted', 'licenceNumberEncrypted', 'documentNumberEncrypted',
  'pickupPinEncrypted', 'pickupPinHash', 'publicTokenEncrypted',
  'offerTokenEncrypted', 'publicTokenHash', 'tokenHash', 'qrTokenHash',
  'guestLookupCode', 'lookupCode', 'accessCode',
  'webhookSecret', 'apiSecret', 'apiKey', 'consumerSecret', 'consumerKey', 'privateKey', 'vapidPrivateKey',
  'accessToken', 'refreshToken', 'resetToken', 'verificationToken', 'passwordResetToken',
  'identityNumber', 'documentNumber', 'nationalIdNumber', 'driverLicenceNumber', 'passportNumber', 'accountNumber',
  'rawPayload', 'providerRawPayload',
]);

const NORMALIZED_REDACTED_KEYS = new Set([...REDACTED_KEYS].map((key) => String(key).replace(/[^a-z0-9]/gi, '').toLowerCase()));

function sensitiveResponseKey(key = '') {
  const normalized = String(key || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  return NORMALIZED_REDACTED_KEYS.has(normalized) || /(?:encrypted|hash)$/.test(normalized);
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function scrubSensitiveResponse(value, depth = 0, seen = new WeakSet()) {
  if (depth > 14 || value == null || typeof value !== 'object') return value;
  if (Buffer.isBuffer(value) || value instanceof Date) return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => scrubSensitiveResponse(item, depth + 1, seen));
  if (!plainObject(value)) {
    if (typeof value.toObject === 'function') return scrubSensitiveResponse(value.toObject(), depth + 1, seen);
    return value;
  }

  const clean = {};
  for (const [key, nested] of Object.entries(value)) {
    if (sensitiveResponseKey(key)) continue;
    clean[key] = scrubSensitiveResponse(nested, depth + 1, seen);
  }
  return clean;
}

function apiResponseSecurity(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = function secureJson(payload) {
    if (String(req.originalUrl || req.path || '').startsWith('/api/')) {
      if (req.session?.user) res.setHeader('Cache-Control', 'no-store, private');
      return originalJson(scrubSensitiveResponse(payload));
    }
    return originalJson(payload);
  };
  next();
}

module.exports = { REDACTED_KEYS, sensitiveResponseKey, scrubSensitiveResponse, apiResponseSecurity };

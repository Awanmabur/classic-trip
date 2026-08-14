'use strict';

const MAX_SCAN_DEPTH = 16;
const MAX_SCAN_NODES = 6000;

// Fields whose authority must always come from authenticated server state,
// canonical inventory/pricing, payment-provider verification, or ownership
// resolution. Public/auth endpoints reject them instead of silently trusting or
// mass-assigning them.
const PUBLIC_PROTECTED_FIELDS = new Set([
  '_id', 'id', 'ownerId', 'companyId', 'userId', 'customerUserId', 'createdBy', 'updatedBy',
  'passwordHash', 'authVersion', 'permissions', 'permissionsLabel',
  'isVerified', 'emailVerifiedAt', 'phoneVerifiedAt', 'verificationStatus',
  'bookingStatus', 'paymentStatus', 'settlementStatus', 'paidAt', 'providerReference',
  'amount', 'total', 'subtotal', 'grossAmount', 'pricing', 'currency', 'price', 'priceFrom',
  'serviceFee', 'tax', 'fees', 'commissionPercent', 'commercialTermsSnapshot',
  'platformCommission', 'partnerSettlement', 'promoterCommission',
  'refundStatus', 'payoutStatus', 'mfa', 'mfaSetup',
]);

function isPlainContainer(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return true;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function unsafeKey(key) {
  const value = String(key || '');
  return value.startsWith('$') || value.includes('.') || value.includes('\0') || ['__proto__', 'prototype', 'constructor'].includes(value);
}

function scanObject(value, predicate, options = {}) {
  const root = options.root || 'input';
  let nodes = 0;
  const seen = new WeakSet();

  function walk(current, path, depth) {
    if (!isPlainContainer(current)) return null;
    if (depth > MAX_SCAN_DEPTH) return { path, reason: 'too_deep' };
    if (seen.has(current)) return null;
    seen.add(current);
    nodes += 1;
    if (nodes > MAX_SCAN_NODES) return { path, reason: 'too_complex' };

    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index += 1) {
        const nested = walk(current[index], `${path}[${index}]`, depth + 1);
        if (nested) return nested;
      }
      return null;
    }

    for (const [key, nestedValue] of Object.entries(current)) {
      const keyPath = `${path}.${key}`;
      const reason = predicate(key, nestedValue, keyPath);
      if (reason) return { path: keyPath, reason };
      const nested = walk(nestedValue, keyPath, depth + 1);
      if (nested) return nested;
    }
    return null;
  }

  return walk(value, root, 0);
}

function findUnsafeObjectKey(value, root = 'input') {
  return scanObject(value, (key) => (unsafeKey(key) ? 'dangerous_key' : ''), { root });
}

function findProtectedField(value, fields = PUBLIC_PROTECTED_FIELDS, root = 'body') {
  return scanObject(value, (key) => (fields.has(String(key || '')) ? 'protected_field' : ''), { root });
}

function securityError(message, code = 'unsafe_input') {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  return error;
}

function rejectDangerousInputKeys(req, res, next) {
  const bodyProblem = findUnsafeObjectKey(req.body, 'body');
  const queryProblem = findUnsafeObjectKey(req.query, 'query');
  const problem = bodyProblem || queryProblem;
  if (!problem) return next();
  return next(securityError('Request contains an unsupported input field.', problem.reason === 'dangerous_key' ? 'unsafe_input_key' : 'input_too_complex'));
}

function rejectPublicFieldTampering(req, res, next) {
  const problem = findProtectedField(req.body, PUBLIC_PROTECTED_FIELDS, 'body');
  if (!problem) return next();
  return next(securityError('A protected server-managed field was submitted.', 'protected_field_tampering'));
}

function assertSafeObjectKeys(value, root = 'input') {
  const problem = findUnsafeObjectKey(value, root);
  if (problem) throw securityError('Request contains an unsupported input field.', problem.reason === 'dangerous_key' ? 'unsafe_input_key' : 'input_too_complex');
  return true;
}

module.exports = {
  PUBLIC_PROTECTED_FIELDS,
  unsafeKey,
  findUnsafeObjectKey,
  findProtectedField,
  rejectDangerousInputKeys,
  rejectPublicFieldTampering,
  assertSafeObjectKeys,
};

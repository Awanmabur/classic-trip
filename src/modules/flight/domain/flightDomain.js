'use strict';
const crypto = require('crypto');

function cleanText(value, max = 1000) {
  return String(value == null ? '' : value).replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function normalize(value) { return cleanText(value, 120).toLowerCase().replace(/[\s-]+/g, '_'); }
function parseList(value) { return (Array.isArray(value) ? value : String(value || '').split(/[\n,;]+/)).map((v) => cleanText(v, 180)).filter(Boolean); }
function numberValue(value, field, min = 0, max = Number.MAX_SAFE_INTEGER, fallback) {
  if ((value === '' || value == null) && fallback !== undefined) return fallback;
  const n = Number(value); if (!Number.isFinite(n) || n < min || n > max) throw validationError(`${field} must be between ${min} and ${max}`); return n;
}
function integerValue(value, field, min = 0, max = Number.MAX_SAFE_INTEGER, fallback) { return Math.round(numberValue(value, field, min, max, fallback)); }
function boolValue(value, fallback = false) { if (value == null || value === '') return fallback; return ['1','true','on','yes',true,1].includes(value); }
function dateValue(value, field, { future = false } = {}) { const d = new Date(value); if (Number.isNaN(d.getTime())) throw validationError(`${field} must be a valid date and time`); if (future && d.getTime() <= Date.now()) throw validationError(`${field} must be in the future`); return d; }
function validationError(message, status = 422, code = 'validation_error') { const e = new Error(message); e.status = status; e.code = code; return e; }
function notFoundError(message) { return validationError(message, 404, 'not_found'); }
function conflictError(message, code = 'conflict') { return validationError(message, 409, code); }
function hashToken(token) { return crypto.createHash('sha256').update(String(token || '')).digest('hex'); }
function safeEqual(left, right) {
  const a = Buffer.from(String(left == null ? '' : left));
  const b = Buffer.from(String(right == null ? '' : right));
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}
function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }
function code(prefix, bytes = 6) { return `${prefix}-${crypto.randomBytes(bytes).toString('hex').toUpperCase()}`; }
function actorId(actor = {}) { return cleanText(actor.id || actor.userId || actor.actorId || actor.email || 'system', 180); }
function immutable(value) { return JSON.parse(JSON.stringify(value || {})); }
function requireEnum(value, allowed, field) { const v = normalize(value); if (!allowed.includes(v)) throw validationError(`${field} is invalid`); return v; }
function assertCompany(row, companyId, label = 'Record') { if (!row || String(row.companyId || '') !== String(companyId || '')) throw notFoundError(`${label} was not found for this company`); return row; }
function assertActiveSupplier(supplier = {}, capability = '') {
  if (!supplier.id || supplier.status !== 'active') throw conflictError('Flight supplier is not active', 'supplier_unavailable');
  if (supplier.mode === 'external_certified' && supplier.failClosed !== false && capability && !(supplier.capabilities || []).includes(capability)) throw conflictError(`Flight supplier is not certified for ${capability}`, 'supplier_capability_unavailable');
  return supplier;
}
module.exports = { cleanText, normalize, parseList, numberValue, integerValue, boolValue, dateValue, validationError, notFoundError, conflictError, hashToken, safeEqual, randomToken, code, actorId, immutable, requireEnum, assertCompany, assertActiveSupplier };

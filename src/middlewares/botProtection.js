'use strict';

const crypto = require('crypto');
const { env } = require('../config/env');

const PROOF_TTL_MS = 20 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 60 * 1000;

function hmac(value) {
  return crypto.createHmac('sha256', env.sessionSecret).update(String(value || '')).digest('base64url');
}

function createBotProof(now = Date.now()) {
  const issuedAt = Number(now);
  const nonce = crypto.randomBytes(18).toString('base64url');
  const payload = `${issuedAt}.${nonce}`;
  return `${payload}.${hmac(`classic-trip-form:${payload}`)}`;
}

function timingSafeTextEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function validBotProof(value, now = Date.now()) {
  const parts = String(value || '').split('.');
  if (parts.length !== 3) return false;
  const [issuedAtRaw, nonce, signature] = parts;
  if (!/^\d{10,16}$/.test(issuedAtRaw) || !/^[A-Za-z0-9_-]{16,80}$/.test(nonce)) return false;
  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt)) return false;
  const age = Number(now) - issuedAt;
  if (age < -MAX_FUTURE_SKEW_MS || age > PROOF_TTL_MS) return false;
  const payload = `${issuedAtRaw}.${nonce}`;
  return timingSafeTextEqual(signature, hmac(`classic-trip-form:${payload}`));
}

function attachBotProof(req, res, next) {
  res.locals.botProof = createBotProof();
  next();
}

function humanFormGuard(req, res, next) {
  // Layered low-friction bot defense for public auth/onboarding forms: a hidden
  // honeypot plus an HMAC-signed, short-lived proof that must have come from a
  // recently rendered Classic Trip page. IP/account rate limits remain active
  // before password verification, so automated abuse is also throttled.
  if (String(req.body?._ct_hp || '').trim()) {
    const error = new Error('Automated form submission rejected');
    error.status = 400;
    error.code = 'bot_submission_rejected';
    return next(error);
  }
  if (!validBotProof(req.body?._ct_bot)) {
    const error = new Error('This form expired. Refresh the page and try again.');
    error.status = 400;
    error.code = 'bot_proof_invalid';
    return next(error);
  }
  return next();
}

module.exports = { createBotProof, validBotProof, attachBotProof, humanFormGuard, PROOF_TTL_MS };

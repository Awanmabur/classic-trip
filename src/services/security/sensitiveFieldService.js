'use strict';
const crypto = require('crypto');
const { env } = require('../../config/env');

const LEGACY_VERSION = 'v1';
const CURRENT_VERSION = 'v2';
const CIPHER = 'aes-256-gcm';

function deriveKey(secret, context = 'default') {
  const material = String(secret || '').trim();
  if (!material) return null;
  return crypto.createHash('sha256').update(`classic-trip:${context}:${material}`).digest();
}

function keyForVersion(version, context = 'default') {
  if (version === CURRENT_VERSION) return deriveKey(env.dataEncryptionKey, context);
  // Backward-compatible decryption for values written before v1.6.75.
  if (version === LEGACY_VERSION) return deriveKey(env.sessionSecret, context);
  return null;
}

function encrypt(value, context = 'default') {
  const text = String(value || '').trim();
  if (!text) return '';
  const key = keyForVersion(CURRENT_VERSION, context);
  if (!key) throw new Error('Sensitive-field encryption key is not configured');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(CIPHER, key, iv);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return [CURRENT_VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function decrypt(value, context = 'default') {
  const [version, ivValue, tagValue, ciphertextValue] = String(value || '').split('.');
  const key = keyForVersion(version, context);
  if (!key || !ivValue || !tagValue || !ciphertextValue) return '';
  try {
    const decipher = crypto.createDecipheriv(CIPHER, key, Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, 'base64url')), decipher.final()]).toString('utf8');
  } catch (_) {
    return '';
  }
}

function last4(value) { return String(value || '').trim().slice(-4); }
function isLegacyCiphertext(value) { return String(value || '').startsWith(`${LEGACY_VERSION}.`); }

module.exports = { encrypt, decrypt, last4, isLegacyCiphertext, CURRENT_VERSION, LEGACY_VERSION };

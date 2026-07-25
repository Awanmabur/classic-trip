'use strict';
const crypto = require('crypto');
const { env } = require('../../config/env');

const VERSION = 'v1';
const CIPHER = 'aes-256-gcm';

function keyFor(context = 'default') {
  return crypto.createHash('sha256').update(`classic-trip:${context}:${env.sessionSecret || 'development-only'}`).digest();
}

function encrypt(value, context = 'default') {
  const text = String(value || '').trim();
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(CIPHER, keyFor(context), iv);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function decrypt(value, context = 'default') {
  const [version, ivValue, tagValue, ciphertextValue] = String(value || '').split('.');
  if (version !== VERSION || !ivValue || !tagValue || !ciphertextValue) return '';
  try {
    const decipher = crypto.createDecipheriv(CIPHER, keyFor(context), Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, 'base64url')), decipher.final()]).toString('utf8');
  } catch (_) {
    return '';
  }
}

function last4(value) { return String(value || '').trim().slice(-4); }

module.exports = { encrypt, decrypt, last4 };

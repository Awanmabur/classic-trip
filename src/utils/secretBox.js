'use strict';

const crypto = require('crypto');
const { env } = require('../config/env');

function clean(value) { return String(value || '').trim(); }
function keyMaterial(purpose = 'application-secret') {
  const source = clean(env.mfaEncryptionKey || env.sessionSecret);
  if (!source) throw Object.assign(new Error('Sensitive-data encryption key is not configured'), { status: 500, code: 'encryption_key_missing' });
  return crypto.createHash('sha256').update(`${purpose}:${source}`).digest();
}

function seal(value, purpose = 'application-secret') {
  const plaintext = clean(value);
  if (!plaintext) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyMaterial(purpose), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString('base64url')).join('.');
}

function open(value, purpose = 'application-secret') {
  const [ivValue, tagValue, cipherValue] = clean(value).split('.');
  if (!ivValue || !tagValue || !cipherValue) return '';
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyMaterial(purpose), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(cipherValue, 'base64url')), decipher.final()]).toString('utf8');
}

module.exports = { seal, open };

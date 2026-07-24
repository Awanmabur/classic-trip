'use strict';

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_BYTES = 72;

function passwordByteLength(password = '') {
  return Buffer.byteLength(String(password || ''), 'utf8');
}

function validatePassword(password = '') {
  const value = String(password || '');
  const byteLength = passwordByteLength(value);
  if (value.length < MIN_PASSWORD_LENGTH || byteLength > MAX_PASSWORD_BYTES || !/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    const error = new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters, no more than ${MAX_PASSWORD_BYTES} UTF-8 bytes, and contain a letter and number`);
    error.status = 422;
    error.code = 'invalid_password_policy';
    throw error;
  }
  return value;
}

module.exports = {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_BYTES,
  passwordByteLength,
  validatePassword,
};

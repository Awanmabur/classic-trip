'use strict';

const assert = require('assert');
const test = require('node:test');
const {
  findUnsafeObjectKey,
  findProtectedField,
  assertSafeObjectKeys,
  PUBLIC_PROTECTED_FIELDS,
} = require('../../src/middlewares/requestSecurity');
const { createBotProof, validBotProof, PROOF_TTL_MS } = require('../../src/middlewares/botProtection');
const { scrubSensitiveResponse } = require('../../src/middlewares/apiResponseSecurity');
const sensitiveFieldService = require('../../src/services/security/sensitiveFieldService');
const { sanitizeLogValue } = require('../../src/config/logger');

test('request security rejects nested Mongo-style operator and dotted keys', () => {
  assert(findUnsafeObjectKey({ profile: { $ne: null } }));
  assert(findUnsafeObjectKey({ profile: { 'role.admin': true } }));
  assert(findUnsafeObjectKey({ constructor: { prototype: { admin: true } } }));
  assert.throws(() => assertSafeObjectKeys({ nested: { $where: 'x' } }), /unsupported input field/i);
  assert.strictEqual(findUnsafeObjectKey({ safe: { nested: ['ok'] } }), null);
});

test('public protected-field scanner catches pricing/payment/server-owned fields', () => {
  assert(PUBLIC_PROTECTED_FIELDS.has('paymentStatus'));
  assert(PUBLIC_PROTECTED_FIELDS.has('commissionPercent'));
  assert(findProtectedField({ passenger: { paymentStatus: 'successful' } }));
  assert(findProtectedField({ pricing: { total: 1 } }));
  assert.strictEqual(findProtectedField({ listingId: 'listing-1', fullName: 'Guest' }), null);
});

test('signed human-form proof rejects tampering and expiry', () => {
  const now = Date.now();
  const proof = createBotProof(now);
  assert.strictEqual(validBotProof(proof, now + 1000), true);
  assert.strictEqual(validBotProof(`${proof.slice(0, -1)}x`, now + 1000), false);
  assert.strictEqual(validBotProof(proof, now + PROOF_TTL_MS + 1), false);
});

test('API scrubber removes secrets recursively without mutating ordinary fields', () => {
  const output = scrubSensitiveResponse({
    id: 'safe-id',
    passwordHash: 'hash',
    identityNumber: 'SS-123456',
    nested: { consumerSecret: 'secret', accessToken: 'token', documentNumber: 'P123456', label: 'safe' },
    rows: [{ apiKey: 'key', accountNumber: '00112233', amount: 100 }],
  });
  assert.deepStrictEqual(output, { id: 'safe-id', nested: { label: 'safe' }, rows: [{ amount: 100 }] });
});

test('sensitive field service writes versioned AES-GCM ciphertext and decrypts it', () => {
  const encrypted = sensitiveFieldService.encrypt('SS-123456', 'test-national-id');
  assert(encrypted.startsWith('v2.'));
  assert.notStrictEqual(encrypted.includes('SS-123456'), true);
  assert.strictEqual(sensitiveFieldService.decrypt(encrypted, 'test-national-id'), 'SS-123456');
});


test('logger redacts secret metadata and credentials embedded in URLs', () => {
  assert.strictEqual(sanitizeLogValue('super-secret', 'consumerSecret'), '[REDACTED]');
  assert.strictEqual(sanitizeLogValue('Bearer abc.def.ghi', 'message'), 'Bearer [REDACTED]');
  assert.strictEqual(sanitizeLogValue('https://user:pass@service.example/path', 'url'), 'https://user:[REDACTED]@service.example/path');
  assert.strictEqual(sanitizeLogValue('SS-123456', 'identityNumber'), '[REDACTED]');
});

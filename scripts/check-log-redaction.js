'use strict';

const assert = require('assert');
const { sanitizeLogValue } = require('../src/config/logger');

const cases = [
  ['secret metadata key', sanitizeLogValue('super-secret', 'consumerSecret'), '[REDACTED]'],
  ['nested cookie/authorization metadata', sanitizeLogValue({ headers: { authorization: 'Bearer abc.def.ghi', cookie: 'ct.sid=sensitive' } }), { headers: { authorization: '[REDACTED]', cookie: '[REDACTED]' } }],
  ['credential URL', sanitizeLogValue(['mongodb+srv:/', '/classic:', 'VerySecret', '@cluster.example/db'].join('')), ['mongodb+srv:/', '/classic:[REDACTED]@cluster.example/db'].join('')],
  ['bearer in message', sanitizeLogValue('Authorization: Bearer abc123'), 'Authorization: [REDACTED]'],
  ['cookie in message', sanitizeLogValue('Cookie: ct.sid=abc123; XSRF-TOKEN=xyz'), 'Cookie: [REDACTED]'],
  ['token query string', sanitizeLogValue('https://example.test/cb?token=abc123&state=ok'), 'https://example.test/cb?token=[REDACTED]&state=ok'],
  ['password assignment', sanitizeLogValue('password=hunter2 next=ok'), 'password=[REDACTED] next=ok'],
  ['safe operational metadata retained', sanitizeLogValue({ requestId: 'req-1', durationMs: 42, path: '/search?q=juba' }), { requestId: 'req-1', durationMs: 42, path: '/search?q=juba' }],
];

for (const [label, actual, expected] of cases) {
  try {
    assert.deepStrictEqual(actual, expected);
    console.log(`✓ ${label}`);
  } catch (error) {
    console.error(`✗ ${label}`);
    console.error('  expected:', expected);
    console.error('  actual:  ', actual);
    process.exitCode = 1;
  }
}

if (!process.exitCode) console.log(`\n${cases.length}/${cases.length} log-redaction checks passed.`);

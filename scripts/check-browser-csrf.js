#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

async function main() {
  const source = fs.readFileSync(path.resolve(__dirname, '../public/js/csrf.js'), 'utf8');
  const listeners = {};
  const existingInput = { type: 'hidden', name: '_csrf', value: 'stale-token' };
  const form = {
    method: 'post',
    querySelector(selector) { return selector === 'input[name="_csrf"]' ? existingInput : null; },
    appendChild() { throw new Error('Existing CSRF field should be reused'); },
  };
  let fetchInit = null;
  const document = {
    cookie: 'other=value; XSRF-TOKEN=fresh-session-token',
    querySelector(selector) {
      if (selector === 'meta[name="csrf-token"]') return { getAttribute: () => 'stale-meta-token' };
      return null;
    },
    querySelectorAll() { return []; },
    createElement() { return {}; },
    addEventListener(name, listener) { listeners[name] = listener; },
  };
  const window = {
    fetch(input, init) { fetchInit = init; return Promise.resolve({ ok: true }); },
  };
  const context = vm.createContext({ document, window, Headers, Object, String, RegExp, decodeURIComponent });
  vm.runInContext(source, context, { filename: 'public/js/csrf.js' });

  assert.strictEqual(window.ClassicTripCsrf.token(), 'fresh-session-token', 'Cookie token must override stale page metadata');
  listeners.submit({ target: form });
  assert.strictEqual(existingInput.value, 'fresh-session-token', 'Submit handler must replace stale hidden tokens');

  const finalFields = new Map();
  listeners.formdata({ formData: { set: (key, value) => finalFields.set(key, value) } });
  assert.strictEqual(finalFields.get('_csrf'), 'fresh-session-token', 'FormData payload must receive the current token');

  await window.fetch('/company/bus-services', { method: 'POST', body: {} });
  assert.strictEqual(fetchInit.headers.get('x-csrf-token'), 'fresh-session-token', 'Fetch POST must receive the current token header');

  console.log('Browser CSRF synchronization passed: 4/4');
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});

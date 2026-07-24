'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('browser CSRF synchronization', () => {
  test('refreshes stale dynamic multipart fields from the current session cookie', async () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../public/js/csrf.js'), 'utf8');
    const listeners = {};
    const input = { value: 'stale-token' };
    const form = {
      method: 'post',
      querySelector: (selector) => (selector === 'input[name="_csrf"]' ? input : null),
      appendChild: jest.fn(),
    };
    let fetchInit;
    const document = {
      cookie: 'XSRF-TOKEN=fresh-token',
      querySelector: (selector) => (selector === 'meta[name="csrf-token"]' ? { getAttribute: () => 'stale-meta-token' } : null),
      querySelectorAll: () => [],
      createElement: () => ({}),
      addEventListener: (name, callback) => { listeners[name] = callback; },
    };
    const window = {
      fetch: (inputArg, initArg) => { fetchInit = initArg; return Promise.resolve({ ok: true }); },
    };
    vm.runInNewContext(source, { document, window, Headers, Object, String, RegExp, decodeURIComponent });

    listeners.submit({ target: form });
    expect(input.value).toBe('fresh-token');
    expect(form.appendChild).not.toHaveBeenCalled();

    const payload = new Map();
    listeners.formdata({ formData: { set: (key, value) => payload.set(key, value) } });
    expect(payload.get('_csrf')).toBe('fresh-token');

    await window.fetch('/company/bus-services', { method: 'POST', body: {} });
    expect(fetchInit.headers.get('x-csrf-token')).toBe('fresh-token');
  });
});

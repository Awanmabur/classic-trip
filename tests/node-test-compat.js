'use strict';

const assert = require('node:assert/strict');
const nodeTest = require('node:test');

const ARRAY_CONTAINING = Symbol('arrayContaining');

function isArrayContaining(value) {
  return Boolean(value && value[ARRAY_CONTAINING]);
}

function deepIncludes(array, expected) {
  return array.some((item) => {
    try {
      assert.deepStrictEqual(item, expected);
      return true;
    } catch {
      return false;
    }
  });
}

function matchesArrayContaining(received, expected) {
  return Array.isArray(received)
    && expected.sample.every((item) => deepIncludes(received, item));
}

function partialMatch(received, expected) {
  if (expected === null || typeof expected !== 'object') return Object.is(received, expected);
  if (isArrayContaining(expected)) return matchesArrayContaining(received, expected);
  if (Array.isArray(expected)) {
    return Array.isArray(received)
      && expected.length === received.length
      && expected.every((item, index) => partialMatch(received[index], item));
  }
  if (!received || typeof received !== 'object') return false;
  return Object.entries(expected).every(([key, value]) => partialMatch(received[key], value));
}

function makeMock(implementation) {
  const mock = function mockFunction(...args) {
    mock.mock.calls.push(args);
    return implementation ? implementation.apply(this, args) : undefined;
  };
  mock.mock = { calls: [] };
  return mock;
}

function buildMatchers(received, negate = false) {
  function verify(condition, message) {
    const passed = negate ? !condition : condition;
    if (!passed) throw new assert.AssertionError({ message });
  }

  return {
    get not() {
      return buildMatchers(received, !negate);
    },
    toBe(expected) {
      verify(Object.is(received, expected), `Expected ${received} ${negate ? 'not ' : ''}to be ${expected}`);
    },
    toEqual(expected) {
      let equal;
      if (isArrayContaining(expected)) equal = matchesArrayContaining(received, expected);
      else {
        try { assert.deepStrictEqual(received, expected); equal = true; } catch { equal = false; }
      }
      verify(equal, `Expected values ${negate ? 'not ' : ''}to be deeply equal`);
    },
    toMatchObject(expected) {
      verify(partialMatch(received, expected), `Expected object ${negate ? 'not ' : ''}to match the supplied properties`);
    },
    toMatch(expected) {
      const value = String(received);
      const matched = expected instanceof RegExp ? expected.test(value) : value.includes(String(expected));
      verify(matched, `Expected ${value} ${negate ? 'not ' : ''}to match ${expected}`);
    },
    toContain(expected) {
      const contains = typeof received === 'string'
        ? received.includes(String(expected))
        : Array.isArray(received) && deepIncludes(received, expected);
      verify(contains, `Expected value ${negate ? 'not ' : ''}to contain ${expected}`);
    },
    toHaveLength(expected) {
      verify(received != null && received.length === expected, `Expected length ${negate ? 'not ' : ''}to be ${expected}`);
    },
    toBeDefined() {
      verify(received !== undefined, `Expected value ${negate ? 'not ' : ''}to be defined`);
    },
    toBeUndefined() {
      verify(received === undefined, `Expected value ${negate ? 'not ' : ''}to be undefined`);
    },
    toBeTruthy() {
      verify(Boolean(received), `Expected value ${negate ? 'not ' : ''}to be truthy`);
    },
    toThrow(expected) {
      let thrown;
      try { received(); } catch (error) { thrown = error; }
      let matched = Boolean(thrown);
      if (matched && expected instanceof RegExp) matched = expected.test(String(thrown.message || thrown));
      else if (matched && typeof expected === 'string') matched = String(thrown.message || thrown).includes(expected);
      verify(matched, `Expected function ${negate ? 'not ' : ''}to throw${expected ? ` ${expected}` : ''}`);
    },
    toHaveBeenCalled() {
      verify(Boolean(received?.mock?.calls?.length), `Expected mock ${negate ? 'not ' : ''}to have been called`);
    },
  };
}

function expect(received) {
  return buildMatchers(received);
}
expect.arrayContaining = (sample) => ({ [ARRAY_CONTAINING]: true, sample });

function eachTitle(template, values, index) {
  let cursor = 0;
  return String(template)
    .replace(/%#/g, String(index))
    .replace(/%[sdifjo]/g, (token) => {
      const value = values[cursor];
      cursor += 1;
      if (token === '%j' || token === '%o') {
        try { return JSON.stringify(value); } catch { return String(value); }
      }
      if (token === '%d' || token === '%i' || token === '%f') return String(Number(value));
      return String(value);
    });
}

function addEach(runner) {
  runner.each = (rows) => (template, implementation) => {
    if (!Array.isArray(rows)) throw new TypeError('test.each expects an array of cases');
    rows.forEach((row, index) => {
      const values = Array.isArray(row) ? row : [row];
      runner(eachTitle(template, values, index), () => implementation(...values));
    });
  };
  return runner;
}

global.test = addEach(nodeTest.test);
global.it = addEach(nodeTest.it);
global.describe = addEach(nodeTest.describe);
global.beforeAll = nodeTest.before;
global.afterAll = nodeTest.after;
global.beforeEach = nodeTest.beforeEach;
global.afterEach = nodeTest.afterEach;
global.expect = expect;
global.jest = { fn: makeMock };

#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const packages = lock.packages || {};
const checks = [];

function check(label, condition) {
  if (!condition) throw new Error(label);
  checks.push(label);
}

function resolveDependency(fromPath, name) {
  let current = fromPath;
  while (true) {
    const candidate = current ? `${current}/node_modules/${name}` : `node_modules/${name}`;
    if (packages[candidate]) return candidate;
    if (!current) return null;
    const index = current.lastIndexOf('/node_modules/');
    current = index >= 0 ? current.slice(0, index) : '';
  }
}


function versionAtLeast(actual, required) {
  const parse = (value) => String(value || '').split('.').slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(actual);
  const right = parse(required);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] > right[i]) return true;
    if (left[i] < right[i]) return false;
  }
  return true;
}

function dependencyNames(meta) {
  return [meta.dependencies, meta.optionalDependencies, meta.peerDependencies]
    .flatMap((group) => Object.keys(group || {}));
}

const rootLock = packages[''] || {};
check('package-lock uses lockfileVersion 3', lock.lockfileVersion === 3);
check('package and lock versions match', lock.version === pkg.version && rootLock.version === pkg.version);
check('runtime dependencies match package.json', JSON.stringify(rootLock.dependencies || {}) === JSON.stringify(pkg.dependencies || {}));
check('development dependencies match package.json', JSON.stringify(rootLock.devDependencies || {}) === JSON.stringify(pkg.devDependencies || {}));
check('unit tests use the built-in Node test runner', pkg.scripts?.test === 'node scripts/run-unit-tests.js');
check('obsolete Jest dependency is removed', !pkg.devDependencies?.jest && !packages['node_modules/jest']);
check('unused Supertest dependency is removed', !pkg.devDependencies?.supertest && !packages['node_modules/supertest']);
check('deprecated inflight package is removed', !packages['node_modules/inflight']);
check('deprecated glob 7 package is removed', !packages['node_modules/glob']);
check('external development watcher is removed', !packages['node_modules/nodemon'] && !rootLock.devDependencies?.nodemon);
check('lodash includes the 2026 code-injection fix', !packages['node_modules/lodash'] || versionAtLeast(packages['node_modules/lodash'].version, '4.18.0'));
check('Express route matcher includes the 2026 ReDoS fix', !packages['node_modules/path-to-regexp'] || versionAtLeast(packages['node_modules/path-to-regexp'].version, '0.1.13'));
check('Multer includes the hardened 2.2 release', !packages['node_modules/multer'] || versionAtLeast(packages['node_modules/multer'].version, '2.2.0'));

const missing = [];
for (const [packagePath, meta] of Object.entries(packages)) {
  for (const name of dependencyNames(meta)) {
    if (!resolveDependency(packagePath, name)) {
      const optional = Object.prototype.hasOwnProperty.call(meta.optionalDependencies || {}, name)
        || Object.prototype.hasOwnProperty.call(meta.peerDependenciesMeta || {}, name)
          && meta.peerDependenciesMeta[name]?.optional;
      if (!optional) missing.push(`${packagePath || '<root>'} -> ${name}`);
    }
  }
}
check('all required lockfile dependency references resolve', missing.length === 0);

const reachable = new Set(['']);
const queue = [''];
while (queue.length) {
  const current = queue.shift();
  const meta = packages[current] || {};
  const names = dependencyNames(meta);
  if (current === '') names.push(...Object.keys(meta.devDependencies || {}));
  for (const name of names) {
    const resolved = resolveDependency(current, name);
    if (resolved && !reachable.has(resolved)) {
      reachable.add(resolved);
      queue.push(resolved);
    }
  }
}
const unreachable = Object.keys(packages).filter((packagePath) => !reachable.has(packagePath));
check('lockfile contains no unreachable package entries', unreachable.length === 0);

const registryEntries = Object.entries(packages)
  .filter(([, meta]) => typeof meta.resolved === 'string' && meta.resolved.includes('registry.npmjs.org'));
check('registry packages include integrity hashes', registryEntries.every(([, meta]) => typeof meta.integrity === 'string' && meta.integrity.startsWith('sha512-')));
check('lockfile contains no private mirror URLs', !JSON.stringify(lock).includes('applied-caas-gateway'));

console.log(`Lockfile integrity checks passed (${checks.length}/${checks.length}, ${Object.keys(packages).length - 1} package entries).`);

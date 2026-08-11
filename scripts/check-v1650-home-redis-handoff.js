'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = require('../package.json');
const catalog = read('src/services/marketplace/catalogService.js');
const checks = [];
const check = (name, ok) => checks.push([name, Boolean(ok)]);

check('release is v1.6.50', pkg.version === '1.6.50');
check('Home has a dedicated shared Redis snapshot key', catalog.includes("redisRuntime.key('home-bootstrap', 'public')"));
check('shared Home payload is compressed before Redis persistence', catalog.includes('writeSharedHomeBootstrap') && catalog.includes('gzipAsync'));
check('a restarted process hydrates Home directly from Redis', catalog.includes('hydrateHomeBootstrapFromSharedCache') && catalog.includes('if (!options.force && !homeBootstrapCache) await hydrateHomeBootstrapFromSharedCache()'));
check('Home shared cache respects the existing stale window', catalog.includes('{ PX: env.performance.homeViewCacheStaleMs }'));
const prewarm = catalog.slice(catalog.indexOf('async function prewarmHome()'), catalog.indexOf('function companyFor'));
check('prewarm primes compact Home cache before the raw catalog', prewarm.indexOf('await hydrateHomeBootstrapFromSharedCache();') >= 0 && prewarm.indexOf('await hydrateHomeBootstrapFromSharedCache();') < prewarm.indexOf('await hydrateSnapshotFromSharedCache();'));
check('a shared Home hit returns while live refresh continues', catalog.includes('if (homeBootstrapCache) {') && catalog.includes('refreshHomeBootstrap().catch(() => {});') && catalog.includes('return homeBootstrapCache;'));
check('first upgrade can prime Home from the older shared full catalog', catalog.includes('primeHomeBootstrapFromCatalogCache') && catalog.includes('if (snapshotCache) {') && catalog.includes('const primed = primeHomeBootstrapFromCatalogCache();'));
check('fresh Home rebuild persists its successful result to Redis', catalog.includes('writeSharedHomeBootstrap(value, createdAt).catch(() => {});'));

const failed = checks.filter(([, ok]) => !ok);
checks.forEach(([name, ok]) => console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`));
if (failed.length) {
  console.error(`v1.6.50 Home Redis handoff checks failed (${checks.length - failed.length}/${checks.length}).`);
  process.exit(1);
}
console.log(`v1.6.50 Home Redis handoff checks passed (${checks.length}/${checks.length}).`);

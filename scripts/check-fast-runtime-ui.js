#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const css = read('public/css/completion-fixes.css');
const server = read('src/server.js');
const catalog = read('src/services/marketplace/catalogService.js');
const env = read('src/config/env.js');
const redis = read('src/config/redis.js');
const localRedis = read('scripts/redis-local.js');
const render = read('render.yaml');
const checks = [];
function check(name, fn) { try { fn(); checks.push(true); console.log(`✓ ${name}`); } catch (e) { checks.push(false); console.error(`✗ ${name} — ${e.message}`); process.exitCode = 1; } }
check('release is v1.6.80', () => assert.strictEqual(pkg.version, '1.6.80'));
check('Stay Bar image column stretches through the complete row', () => assert(css.includes('v1.6.80: Stay bars must use the same full-height media column') && css.includes('height:auto!important') && css.includes('height:100%!important')));
check('local startup prewarms lightweight discovery before listening', () => assert(server.indexOf('await catalogService.prewarmHome()') > -1 && server.indexOf('await catalogService.prewarmHome()') < server.indexOf('app.listen')));
check('production still uses the non-blocking readiness warmup', () => assert(server.includes('if (!env.isProduction) return;') && server.includes('Public discovery cache warmed before traffic readiness')));
check('public discovery database fan-out is configurable', () => assert(env.includes('PUBLIC_CATALOG_DB_READ_CONCURRENCY') && catalog.includes('publicCatalogReadConcurrency')));
check('Stay preview uses grouped room availability rather than bulk rows', () => { const a=catalog.indexOf('async function loadListingSnapshotFresh'); const b=catalog.indexOf('function sharedListingSnapshotKey',a); const s=catalog.slice(a,b); assert(s.includes("roomUnits.countGroupedBy('roomTypeId'") && s.includes("roomNights.countGroupedBy('roomTypeId'") && !s.includes('roomUnits.list(') && !s.includes('roomNights.list(')); });
check('Redis transient socket resets are debounced but longer outages remain visible', () => assert(redis.includes('transientNoticeDelayMs') && redis.includes('scheduleRuntimeOutageWarning') && redis.includes('Redis connection interrupted; automatic recovery active')));
check('local Redis disables idle timeout and enables TCP keepalive', () => assert(localRedis.includes("'CONFIG', 'SET', 'timeout', '0'") && localRedis.includes("'CONFIG', 'SET', 'tcp-keepalive', '15'")));
check('Render is pinned to Node 24 LTS instead of floating to Current', () => assert(pkg.engines?.node === '>=24 <25' && read('.node-version').trim().startsWith('24.') && (render.match(/key: NODE_VERSION/g)||[]).length === 2));
check('Render warms more Mongo sockets and uses faster discovery fan-out', () => assert(render.includes('MONGO_MIN_POOL_SIZE') && render.includes('value: "4"') && render.includes('PUBLIC_CATALOG_DB_READ_CONCURRENCY')));
if (!process.exitCode) console.log(`\n${checks.length}/${checks.length} fast runtime/UI checks passed.`);

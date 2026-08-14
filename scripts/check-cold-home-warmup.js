#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const server = read('src/server.js');
const publicRoutes = read('src/routes/web/public.js');
const catalog = read('src/services/marketplace/catalogService.js');
const readiness = read('src/config/readiness.js');
const env = read('src/config/env.js');
const render = read('render.yaml');
const checks = [];
function check(name, ok) { checks.push({ name, ok: !!ok }); console.log(`${ok ? '✓' : '✗'} ${name}`); }
check('release is v1.6.82', pkg.version === '1.6.82');
check('production opens the port before background public discovery warmup', server.includes('if (!env.isProduction) return;') && server.includes('catalogService.prewarmHome()'));
check('local startup prewarms public discovery before listening', server.includes('await catalogService.prewarmHome()') && server.indexOf('await catalogService.prewarmHome()') < server.indexOf('app.listen'));
check('production warmup remains non-blocking and Redis-first', server.includes('catalogService.prewarmHome()') && catalog.includes('else await discoverySnapshot();') && server.includes("if (!env.isProduction) return;"));
check('Render readiness waits for public discovery in production', publicRoutes.includes("publicDiscovery: warm.publicDiscoveryReady") && publicRoutes.includes('databaseReady && publicDiscoveryReady'));
check('warmup has a bounded degraded-ready fallback', server.includes('warmup_deadline_exceeded') && env.includes("PUBLIC_WARMUP_MAX_WAIT_MS"));
check('cold discovery reuses cached platform settings instead of rereading Mongo', catalog.includes('getCachedPlatformConfig') && catalog.includes('() => getCachedPlatformConfig()'));
check('Render uses /ready and exposes warmup deadline', render.includes('healthCheckPath: /ready') && render.includes('PUBLIC_WARMUP_MAX_WAIT_MS'));
check('readiness state is startup-scoped and does not depend on later cache invalidations', readiness.includes('publicDiscoveryReady') && !catalog.includes('markPublicDiscoveryReady'));
const failed = checks.filter((row) => !row.ok);
if (failed.length) { console.error(`\nCold Home warmup checks failed (${checks.length-failed.length}/${checks.length}).`); process.exit(1); }
console.log(`\n${checks.length}/${checks.length} cold Home warmup checks passed.`);

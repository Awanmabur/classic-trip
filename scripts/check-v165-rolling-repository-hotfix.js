#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

const pkg = JSON.parse(read('package.json'));
const companyService = read('src/services/company/companyService.js');
const companyRepository = read('src/repositories/domain/companyOperationsRepository.js');
const materializer = read('src/jobs/materializeSchedules.js');
const worker = read('src/worker.js');
const env = read('src/config/env.js');

const usedCollections = new Set(
  [...companyService.matchAll(/companyRepository\.([A-Za-z0-9_]+)/g)].map((match) => match[1]),
);
const registeredCollections = new Set(
  [...companyRepository.matchAll(/^\s{2}([A-Za-z0-9_]+): new MongoCollection\(/gm)].map((match) => match[1]),
);
registeredCollections.add('withTransaction');
const missingCollections = [...usedCollections].filter((name) => !registeredCollections.has(name));

check('package is v1.6.5', pkg.version === '1.6.5');
check('company repository registers routes', companyRepository.includes("routes: new MongoCollection('routes')"));
check('company repository registers route stops', companyRepository.includes("routeStops: new MongoCollection('routeStops')"));
check('every companyService repository dependency is registered', missingCollections.length === 0);
check('rolling materializer has no companyService dependency', !materializer.includes("require('../services/company/companyService')"));
check('rolling batch creation uses the canonical bus service', materializer.includes('busDepartureService.createScheduleDatesBatch('));
check('rolling fallback creation uses the canonical bus service actor', materializer.includes("busDepartureService.createSchedule(rule.companyId, schedulePayload(rule, departAt), 'schedule-materializer')"));
check('rolling watermark update uses the canonical bus service', materializer.includes('busDepartureService.recordScheduleRuleMaterialization('));
check('worker reconciles all active rules on startup', worker.includes("await runJob('materializeSchedules')"));
check('worker retries active rolling rules every 30 seconds', env.includes("materializeSchedules: process.env.JOB_MATERIALIZE_SCHEDULES || '*/30 * * * * *'"));
check('full release gate includes the v1.6.5 hotfix audit', pkg.scripts.verify.includes('npm run check:v165'));

if (missingCollections.length) {
  console.error(`Missing company repository collections: ${missingCollections.join(', ')}`);
}
const failed = checks.filter((item) => !item.ok);
checks.forEach((item) => console.log(`${item.ok ? '✓' : '✗'} ${item.name}`));
if (failed.length) {
  console.error(`v1.6.5 rolling repository hotfix audit failed (${checks.length - failed.length}/${checks.length}).`);
  process.exit(1);
}
console.log(`v1.6.5 rolling repository hotfix audit passed (${checks.length}/${checks.length}).`);

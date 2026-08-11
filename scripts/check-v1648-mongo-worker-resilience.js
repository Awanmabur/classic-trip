'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const materializer = read('src/jobs/materializeSchedules.js');
const server = read('src/server.js');
const worker = read('src/worker.js');
const start = read('scripts/start.js');
const test = read('tests/unit/rollingMongoOutageClassification.test.js');
const packageJson = require('../package.json');
const checks = [];
const check = (name, ok) => checks.push([name, Boolean(ok)]);

check('reported Atlas socket timeout is a global Mongo outage', materializer.includes("name = String(error.name || '').toLowerCase()") && materializer.includes('connection \\d+ to [^ ]+:\\d+ timed out'));
check('rolling queue pauses once before per-rule retry logging', materializer.indexOf('if (isMongoUnavailable(error))') < materializer.indexOf("logger.warn('Rolling departure batch failed and will retry'"));
check('global outage pause uses bounded exponential retry timing', materializer.includes('15_000 * (2 **') && materializer.includes('5 * 60 * 1000'));
check('web and worker identify their process roles on direct launch', server.includes("CLASSIC_TRIP_PROCESS_ROLE || 'web'") && worker.includes("CLASSIC_TRIP_PROCESS_ROLE || 'worker'"));
check('rolling outage logs identify the owning process', (materializer.match(/process: process\.env\.CLASSIC_TRIP_PROCESS_ROLE/g) || []).length >= 2);
check('normal start still launches a separate worker and disables web fallback', start.includes("launch('worker'") && start.includes("WEB_ROLLING_FALLBACK: 'false'"));
check('exact production log shape has unit regression coverage', test.includes('connection 118 to 159.41.95.25:27017 timed out') && test.includes("name: 'MongoNetworkTimeoutError'"));
check('release contains the v1.6.48 Mongo worker resilience gate', Number(packageJson.version.split('.')[2]) >= 48);

const failed = checks.filter(([, ok]) => !ok);
checks.forEach(([name, ok]) => console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`));
if (failed.length) {
  console.error(`v1.6.48 Mongo worker resilience checks failed (${checks.length - failed.length}/${checks.length}).`);
  process.exit(1);
}
console.log(`v1.6.48 Mongo worker resilience checks passed (${checks.length}/${checks.length}).`);

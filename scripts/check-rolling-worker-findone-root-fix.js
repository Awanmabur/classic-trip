#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

const pkg = JSON.parse(read('package.json'));
const materializer = read('src/jobs/materializeSchedules.js');
const regression = read('tests/unit/rollingWorkerFindOneRepair.test.js');
const sw = read('public/sw.js');

check('release and browser cache stay aligned', sw.includes(`classic-trip-static-v${pkg.version}`));
check('existing rolling windows use the same single-date batch creator as the first date',
  materializer.includes("tagRollingFailure(error, 'repair_existing_window_create')")
  && materializer.includes('const result = await companyService.createScheduleBatch(rule.companyId'));
check('the worker no longer executes the context-reuse series repair path',
  !materializer.includes('const series = await busDepartureService.createScheduleSeries'));
check('undefined.findOne is treated as a bounded internal retry instead of a permanent skipped date',
  materializer.includes('function isInternalRuntimeFailure')
  && materializer.includes("failure.code = 'rolling_internal_runtime_failure'")
  && materializer.includes('isInternalRuntimeFailure(error)'));
check('rolling retries log stage, code and stack for actionable diagnosis',
  materializer.includes("stage: error.rollingStage || 'materialize_rule'")
  && materializer.includes('code: error.code ||')
  && materializer.includes('stack: error.stack'));
check('regression test covers one existing date plus the undefined.findOne failure',
  regression.includes('keeps creating Draft dates')
  && regression.includes("Cannot read properties of undefined (reading 'findOne')")
  && regression.includes("expect(failure.code).toBe('rolling_internal_runtime_failure')"));
check('full verification includes this rolling worker audit',
  pkg.scripts.verify.includes('npm run check:rolling-worker-findone'));

const failed = checks.filter((row) => !row.ok);
checks.forEach((row) => console.log(`${row.ok ? '✓' : '✗'} ${row.name}`));
if (failed.length) {
  console.error(`Rolling worker findOne root-fix audit failed (${checks.length - failed.length}/${checks.length}).`);
  process.exit(1);
}
console.log(`Rolling worker findOne root-fix audit passed (${checks.length}/${checks.length}).`);

#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function ok(label, fn) {
  try { fn(); console.log(`✓ ${label}`); return 1; }
  catch (error) { console.error(`✗ ${label} — ${error.message}`); return 0; }
}

let passed = 0;
let total = 0;
function check(label, fn) { total += 1; passed += ok(label, fn); }

const publicRoutes = read('src/routes/web/public.js');
const retryTest = read('tests/unit/backendIntegrationContracts.test.js');
const commission = read('src/utils/calculateCommission.js');
const commissionTest = read('tests/unit/calculateCommission.test.js');
const commercialTermsTest = read('tests/unit/commercialTermsService.test.js');
const shell = read('src/services/dashboard/shellConfig.js');
const rolling = read('src/jobs/materializeSchedules.js');
const rollingLifecycleTest = read('tests/unit/rollingMaterializerLifecycle.test.js');
const rollingWorkerTest = read('tests/unit/rollingWorkerFindOneRepair.test.js');

check('payment retry keeps limiter + protected-field tamper rejection', () => {
  const expected = "router.post('/bookings/:bookingRef/payment/retry', paymentLimiter, rejectPublicFieldTampering, bookingPaymentController.retry)";
  assert(publicRoutes.includes(expected));
  assert(retryTest.includes(expected));
});
check('commercial rewards are explicit and no UGX promoter amount is hard-coded', () => {
  assert(!commission.includes('useFixedUgxReward'));
  assert(commissionTest.includes("promoterRewardModel: 'fixed_amount'"));
  assert(commercialTermsTest.includes('fixed per Standard ticket protects partner payout'));
  assert(commercialTermsTest.includes('customer discount and promoter reward come only from Classic Trip share'));
});
check('embedded workflow guide always keeps an in-page anchor', () => {
  assert(shell.includes("if (page === 'workflow-guide') return '#workflow-guide';"));
});
check('rolling date assertions are timezone-safe', () => {
  assert(rollingLifecycleTest.includes('function localDateKey(value)'));
  assert(rollingLifecycleTest.includes("expect(localDateKey(bounds.cursor)).toBe('2026-08-06')"));
});
check('rolling full-window repair contract tracks missingDates implementation', () => {
  assert(rolling.includes('const missingDates = expectedDates.filter'));
  assert(rollingLifecycleTest.includes("expect(source).toContain('const missingDates = expectedDates.filter')"));
});
check('legacy duration hydration tolerates narrow repository contexts', () => {
  assert(rolling.includes('const findRoute = busOperationsRepository.routes?.findOne;'));
  assert(rolling.includes("if (typeof findRoute !== 'function') return rule;"));
});
check('rolling worker fixture supplies route/repository dependencies', () => {
  assert(rollingWorkerTest.includes("installStub(path.join(root, 'src/repositories/index.js')"));
  assert(rollingWorkerTest.includes("routes: { async findOne() { return null; } }"));
});
check('rolling worker fixture does not invent vehicle conflicts from the existing rule row', () => {
  assert(rollingWorkerTest.includes('if (filter.vehicleId) return [];'));
  assert(rollingWorkerTest.includes("routeId: 'route-1', vehicleId: 'vehicle-1'"));
  assert(rollingWorkerTest.includes('new Date(2026, 7, 8, 0, 0, 0, 0)'));
});
check('rolling repair pending assertion accepts the full future-window queue', () => {
  assert(rollingWorkerTest.includes('expect(result.pending > 0).toBe(true)'));
  assert(rollingWorkerTest.includes("repeatUntil).toBe('2026-08-07')"));
});

if (passed !== total) {
  console.error(`\nUnit regression fix checks failed (${passed}/${total}).`);
  process.exit(1);
}
console.log(`\n${passed}/${total} unit regression fix checks passed.`);

#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [];
function check(name, condition) {
  checks.push({ name, ok: Boolean(condition) });
}

const workspace = read('public/js/dashboard-workspace.js');
const auth = read('src/controllers/auth/authController.js');
const controller = read('src/controllers/company/scheduleController.js');
const materializer = read('src/jobs/materializeSchedules.js');
const snapshots = read('src/services/dashboard/dashboardSnapshotService.js');
const scheduleView = read('src/views/dashboards/shared/sections/schedules.ejs');
const seatMapView = read('src/views/dashboards/shared/sections/seat-maps.ejs');
const tripSchedule = read('src/models/TripSchedule.js');
const scheduleRule = read('src/models/ScheduleRule.js');
const booking = read('src/models/Booking.js');
const serviceWorker = read('public/sw.js');
const packageJson = JSON.parse(read('package.json'));

check('Required-field validation collects an array instead of one DOM node',
  workspace.includes("const required = $$('[required]', form).filter"));
check('Login does not launch a competing forced dashboard prewarm',
  !auth.includes('prewarmForUser(user)'));
check('Active rolling rules materialize synchronously before success is shown',
  controller.includes('materializeRuleById')
  && controller.includes('await materializeActiveRule(req, rule)'));
check('Create, update and resume all run immediate rolling materialization',
  controller.split('await materializeActiveRule(req, rule)').length >= 5);
check('Materialization reports actual existing, expected and failed dates',
  materializer.includes('expected: expectedDates.length')
  && materializer.includes('existing: expectedDates.length - missingDates.length')
  && materializer.includes('failures: finalFailures'));
check('Live seat maps load only current operational departures',
  snapshots.includes("page === 'seat-maps'")
  && snapshots.includes("options.limit = 40")
  && snapshots.includes("status: { $in: ['active', 'published', 'boarding', 'delayed'] }"));
check('Live seat map bookings are constrained to selected schedule IDs',
  snapshots.includes("normalizedCompanyPage(context) === 'seat-maps' && entity === 'bookings'")
  && snapshots.includes("'ticketLegs.scheduleId': { $in: scheduleIds }")
  && snapshots.includes("'bookingItems.scheduleId': { $in: scheduleIds }"));
check('Schedule and seat-map pages avoid loading segment inventory history',
  !/['"]seat-maps['"]:\s*new Set\([\s\S]*?busSeatSegmentInventories[\s\S]*?\),\s*['"]schedules['"]:/.test(snapshots)
  && !/['"]schedules['"]:\s*new Set\([\s\S]*?busSeatSegmentInventories[\s\S]*?\),\s*['"]hotel-rooms['"]:/.test(snapshots));
check('Departure, rule, fare and add-on tables expose working filters',
  ['#adminSchedulesTable', '#companyScheduleRulesTable', '#companyFareProductsTable', '#companySegmentFaresTable', '#companyServiceAddonsTable']
    .every((target) => scheduleView.includes(`data-filter-target="${target}"`)));
check('Live departure seat-map table exposes search and status filters',
  seatMapView.includes('data-filter-target="#companySeatMapsTable"'));
check('Dashboard query indexes cover company/status/date access patterns',
  tripSchedule.includes('tripScheduleSchema.index({ companyId: 1, status: 1, departAt: 1 })')
  && scheduleRule.includes('scheduleRuleSchema.index({ companyId: 1, status: 1, startDate: 1 })'));

check('Rolling materialization uses a per-rule distributed lease',
  materializer.includes('materializeRuleWithLease')
  && materializer.includes('schedule-rule-materialize:${rule.companyId}:${rule.id}')
  && materializer.includes('jobLeaseService.keepAlive'));
check('Booking indexes support schedule-scoped seat-map reads',
  booking.includes('bookingSchema.index({ companyId: 1, scheduleId: 1, createdAt: -1 })')
  && booking.includes("bookingSchema.index({ companyId: 1, 'ticketLegs.scheduleId': 1, createdAt: -1 })"));
check('Dashboard asset cache is bumped for repaired client code',
  serviceWorker.includes('classic-trip-static-v1.6.10'));
check('The full verification gate includes this dashboard repair audit',
  packageJson.scripts.verify.includes('npm run check:dashboard-runtime-repair'));

const failed = checks.filter((item) => !item.ok);
checks.forEach((item) => console.log(`${item.ok ? '✓' : '✗'} ${item.name}`));
if (failed.length) {
  console.error(`Dashboard runtime repair audit failed (${checks.length - failed.length}/${checks.length}).`);
  process.exit(1);
}
console.log(`Dashboard runtime repair audit passed (${checks.length}/${checks.length}).`);

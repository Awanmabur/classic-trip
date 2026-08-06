#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [];
function check(name, condition) { checks.push({ name, ok: Boolean(condition) }); }

const pkg = JSON.parse(read('package.json'));
const start = read('scripts/start.js');
const scheduleController = read('src/controllers/company/scheduleController.js');
const materializer = read('src/jobs/materializeSchedules.js');
const outboxHandlers = read('src/services/shared/outboxHandlers.js');
const workspace = read('public/js/dashboard-workspace.js');
const schedulesView = read('src/views/dashboards/shared/sections/schedules.ejs');
const seatMapsView = read('src/views/dashboards/shared/sections/seat-maps.ejs');
const snapshots = read('src/services/dashboard/dashboardSnapshotService.js');
const payment = read('src/services/payment/httpPaymentProvider.js');
const pesapal = read('src/services/payment/pesapalPaymentProvider.js');
const flash = read('src/middlewares/flash.js');
const app = read('src/app.js');
const env = read('src/config/env.js');
const serviceWorker = read('public/sw.js');
const render = read('render.yaml');

check('Normal startup launches the web process and background worker',
  start.includes("src', 'server.js") && start.includes("src', 'worker.js") && start.includes('RUN_BACKGROUND_WORKER'));
check('Dedicated Render web service disables the embedded worker',
  render.includes('RUN_BACKGROUND_WORKER') && render.includes('value: \"false\"'));
check('Development startup retains the supported Node watcher',
  start.includes("'--watch'") && start.includes("'--watch-preserve-output'") && start.includes('if (!watch)'));
check('Rolling save creates one dated departure immediately and leaves the remainder to the worker',
  scheduleController.includes('maxCreates: 1') && materializer.includes('const pending ='));
check('Draft rolling departures are retried and published automatically after readiness is fixed',
  materializer.includes('reconcileDraftSchedules') && materializer.includes("status: 'draft'") && materializer.includes('publishSchedule'));
check('Rolling reconciliation runs frequently without creating duplicate far-end dates',
  env.includes("JOB_MATERIALIZE_SCHEDULES || '*/15 * * * *'"));
check('Web fallback completes rolling windows when the separate worker is unavailable',
  materializer.includes('startWebFallback') && materializer.includes('queueRuleMaterialization') && materializer.includes('BACKGROUND_BATCH_SIZE'));
check('Rolling repair batches use the proven single-date batch path after day one',
  materializer.includes('repair_existing_window_create')
  && materializer.includes('companyService.createScheduleBatch')
  && !materializer.includes('const series = await busDepartureService.createScheduleSeries'));
check('Scheduled and outbox rolling passes are bounded instead of flooding the database pool',
  materializer.includes('{ maxCreates: BACKGROUND_BATCH_SIZE }') && outboxHandlers.includes('{ waitForLeaseMs: 5000, maxCreates: 1 }'));
check('Permanent rolling blockers persist a cooldown and are excluded from scans rather than hot-looping',
  materializer.includes("materializationBlockerCode: 'vehicle_schedule_conflict'")
  && materializer.includes('VEHICLE_CONFLICT_BLOCKER_COOLDOWN_MS')
  && materializer.includes('eligibleRules = activeRules.filter((rule) => !activePersistentBlocker(rule, now))'));
check('Rolling feedback reports publication blockers rather than false success',
  scheduleController.includes('Draft blockers:') && scheduleController.includes('background rolling worker'));
check('Payment providers have controlled request timeouts',
  payment.includes('payment_provider_timeout') && pesapal.includes('payment_provider_timeout') && payment.includes('AbortController'));
check('Pesapal reuses its registered IPN ID instead of registering on every checkout',
  pesapal.includes('notificationCache') && pesapal.includes('24 * 60 * 60 * 1000'));
check('Edit forms normalize date/time values and resolve nested record projections',
  workspace.includes('normalizeAdminControlValue') && workspace.includes('const deepValue =') && workspace.includes('aliasless'));
check('Schedule edit restores driver and blocked-seat values',
  workspace.includes("schedule.driverIds.0") && workspace.includes("value:fieldValue('schedule.blockedSeats','blockedSeats')"));
check('Listing edit restores policies, stay timing, amenities and operating instructions',
  ['checkInTime','checkOutTime','pickupInstructions','dropoffInstructions','policy','serviceNotes']
    .every((name) => workspace.includes(`name:'${name}'`)));
check('Departure and seat-map filters use the existing approved compact table toolbar',
  schedulesView.includes('class="tableTools"') && seatMapsView.includes('class="tableTools"')
  && !schedulesView.includes('compactDashboardFilters') && !seatMapsView.includes('compactDashboardFilters'));
check('Dashboard snapshots are cached and queried by active page for every role',
  snapshots.includes("customerId || ''}:${context.activePage || 'overview'")
  && snapshots.includes("promoterId || ''}:${context.activePage || 'overview'")
  && snapshots.includes("companyId || ''}:${context.activePage || 'all'"));
check('Live seat maps avoid company-wide booking and inventory history',
  snapshots.includes("normalizedCompanyPage(context) === 'seat-maps' && entity === 'bookings'")
  && snapshots.includes("options.limit = 40"));
check('Public catalog invalidation runs only for catalog-changing mutations',
  flash.includes('affectsPublicCatalog') && flash.includes('invalidateMarketplaceCache'));
check('Production assets and home catalog use longer safe caches',
  app.includes("env.isProduction ? '30d' : 0") && env.includes("number('HOME_CACHE_TTL_MS', 300000)"));
check('Release cache key and package version preserve the v1.6.11+ baseline',
  pkg.version === '1.6.15' && serviceWorker.includes(`classic-trip-static-v${pkg.version}`));
check('Full verification runs this repair audit',
  pkg.scripts.verify.includes('npm run check:performance-edit-payment-repair'));

const failed = checks.filter((row) => !row.ok);
checks.forEach((row) => console.log(`${row.ok ? '✓' : '✗'} ${row.name}`));
if (failed.length) {
  console.error(`Performance/edit/payment repair audit failed (${checks.length - failed.length}/${checks.length}).`);
  process.exit(1);
}
console.log(`Performance/edit/payment repair audit passed (${checks.length}/${checks.length}).`);

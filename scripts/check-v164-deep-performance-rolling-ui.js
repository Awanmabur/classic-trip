#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

const pkg = JSON.parse(read('package.json'));
const home = read('src/views/pages/home.ejs');
const css = read('public/css/completion-fixes.css');
const listing = read('src/views/pages/listing-details.ejs');
const listingController = read('src/controllers/public/listingController.js');
const scheduleController = read('src/controllers/company/scheduleController.js');
const worker = read('src/worker.js');
const materializer = read('src/jobs/materializeSchedules.js');
const scheduler = read('src/jobs/scheduler.js');
const env = read('src/config/env.js');
const envExample = read('.env.example');
const render = read('render.yaml');
const departureService = read('src/modules/bus/services/busDepartureService.js');
const inventory = read('src/modules/bus/services/busInventoryService.js');
const booking = read('src/modules/bus/services/busBookingService.js');
const dashboardSnapshot = read('src/services/dashboard/dashboardSnapshotService.js');
const dashboardProjection = read('src/services/dashboard/dashboardProjectionEngine.js');
const dashboardService = read('src/services/dashboard/mongoDashboardService.js');
const companyDashboard = read('src/controllers/company/dashboardController.js');
const payment = read('src/services/payment/pesapalPaymentProvider.js');
const serviceWorker = read('public/sw.js');

check('v1.6.5 preserves the v1.6.4 frontend cache assets', ['1.6.4', '1.6.5'].includes(pkg.version) && serviceWorker.includes('classic-trip-static-v1.6.5'));
check('bus and stays use the compact marketplace header', (home.match(/sectionHead sectionHead--marketplace/g) || []).length >= 2);
check('seat and room badges are in the same tools container as their switches', /Seat selection<\/span><div class="sectionViewToggle"/.test(home) && /Room selection<\/span><div class="sectionViewToggle"/.test(home));
check('marketplace tools never wrap and keep compact spacing', css.includes('flex-wrap:nowrap!important') && css.includes('gap:5px!important'));
check('mobile header copy uses the second row while controls stay at the top', css.includes('.sectionHead--marketplace .sectionHeadCopy{display:contents!important}') && css.includes('grid-row:2'));
check('bar cards are two columns on desktop and one on phones', css.includes('grid-template-columns:repeat(2,minmax(0,1fr))!important') && /@media\(max-width:680px\)[\s\S]*sectionListingCollection\[data-view="bars"\]\{grid-template-columns:1fr!important\}/.test(css));
check('bar cards use a landscape image/content split', css.includes('grid-template-columns:minmax(166px,38%) minmax(0,1fr)!important') && css.includes('grid-template-columns:124px minmax(0,1fr)!important'));

check('web save creates only one immediate rolling date', scheduleController.includes('maxCreates: 1'));
check('web process no longer continues month materialization after redirect', !scheduleController.includes('continueMaterializationInProcess'));
check('normal startup and Render keep a real worker path', worker.includes('startScheduledJobs') && render.includes('startCommand: npm run worker') && pkg.scripts.worker.includes('src/worker.js'));
check('rolling reconciliation runs every 30 seconds', env.includes("'*/30 * * * * *'") && envExample.includes('JOB_MATERIALIZE_SCHEDULES=*/30 * * * * *') && render.includes('value: "*/30 * * * * *"'));
check('second-level cron expressions are supported', scheduler.includes('cron.schedule'));
check('materializer batches missing dates and retries draft publication', materializer.includes('createScheduleDatesBatch') && materializer.includes('reconcileDraftSchedules') && materializer.includes('publishSchedule'));
check('rolling materializer carries the saved driver assignment', materializer.includes("driverId: (rule.driverIds || [])[0] || ''"));
check('batch materialization protects small MongoDB pools', departureService.includes('Math.min(2, proposed.length)'));

check('departure options embed immutable route summaries', listingController.includes('publicBusScheduleOption') && listingController.includes('const summary =') && listingController.includes('summary,'));
check('boarding and drop-off render from the local summary before live inventory', listing.indexOf('selectedSchedule?.summary?.stops?.length') < listing.indexOf("fetchScheduleAvailability(scheduleId, journey.originStopId"));
check('boarding and drop-off controls unlock before live seats finish loading', listing.includes('Unlock those controls immediately') && listing.indexOf('setJourneyLoading(false);') < listing.indexOf('const data = await fetchScheduleAvailability(scheduleId, journey.originStopId'));
check('cached schedule context is reused without per-click deep cloning', !inventory.includes('function cloneContext') && inventory.includes('return context;'));

check('checkout page resolves only the fixed held departures', listingController.includes('Resolve both held legs in parallel') && listingController.includes('Promise.all(['));
check('guest booking identifiers are allocated in batches', booking.includes('repository.nextIds') && booking.includes('Promise.all(['));
check('guest booking does not repeat the held schedule query', !booking.includes("repository.schedules.findOne({ id: hold.scheduleId, companyId: hold.companyId })"));
check('Pesapal shares token/IPN work and enforces timeouts', payment.includes('tokenInflight') && payment.includes('notificationInflight') && payment.includes('payment_provider_timeout'));

check('dashboard reads are selected by active page', dashboardSnapshot.includes('COMPANY_PAGE_ENTITIES') && dashboardSnapshot.includes('companyEntityQuery'));
check('seat-map pages query only their current schedule bookings', dashboardSnapshot.includes("normalizedCompanyPage(context) === 'seat-maps'") && dashboardSnapshot.includes("'ticketLegs.scheduleId': { $in: scheduleIds }"));
check('large snapshots and provider payloads are removed from row metadata', ['seatInventorySnapshot','routeSnapshot','providerPayload','requestPayload','responsePayload'].every((key) => dashboardProjection.includes(`'${key}'`)));
check('dashboard relationship lookups use indexes instead of repeated full scans', dashboardProjection.includes('vehicleByIdIndex') && dashboardProjection.includes('vehiclesByCompanyIndex') && dashboardProjection.includes('userByIdIndex'));
check('slow dashboard stages are observable in logs and Server-Timing', dashboardService.includes("logger.warn('Slow dashboard projection'") && companyDashboard.includes("res.set('Server-Timing'"));
check('the full release gate includes this audit', pkg.scripts.verify.includes('npm run check:v164'));

const failed = checks.filter((item) => !item.ok);
checks.forEach((item) => console.log(`${item.ok ? '✓' : '✗'} ${item.name}`));
if (failed.length) {
  console.error(`v1.6.4 deep repair audit failed (${checks.length - failed.length}/${checks.length}).`);
  process.exit(1);
}
console.log(`v1.6.4 deep repair audit passed (${checks.length}/${checks.length}).`);

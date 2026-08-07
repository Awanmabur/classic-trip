'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
let passed = 0;
function check(name, ok) {
  if (!ok) { console.error(`✗ ${name}`); process.exitCode = 1; }
  else { passed += 1; console.log(`✓ ${name}`); }
}
const pkg = JSON.parse(read('package.json'));
const details = read('src/views/pages/listing-details.ejs');
const siteHead = read('src/views/partials/site-head.ejs');
const css = read('public/css/completion-fixes.css');
const snapshot = read('src/services/dashboard/dashboardSnapshotService.js');
const projection = read('src/services/dashboard/dashboardProjectionEngine.js');
const scope = read('src/services/dashboard/companyBusScope.js');
const materializer = read('src/jobs/materializeSchedules.js');
const scheduler = read('src/jobs/scheduler.js');
const model = read('src/models/ScheduleRule.js');
const departureService = read('src/modules/bus/services/busDepartureService.js');
const seatMaps = read('src/views/dashboards/shared/sections/seat-maps.ejs');
check('release version is v1.6.16', Number(String(pkg.version).split('.')[2] || 0) >= 16);
check('ticket class and Journey appear before route and travel', details.indexOf('busTicketChooser') > -1 && details.indexOf('busTicketChooser') < details.indexOf('busJourneyStepGroup'));
check('all four route/travel placeholders remain intact', details.includes('Select route</option>') && details.includes('Select route first') && details.split('Select travel time first').length >= 3);
check('preview receives a scoped body class', details.includes("bodyClass: 'listingPreviewBody'") && siteHead.includes('typeof bodyClass'));
check('preview flashes are red rectangular cards', css.includes('body.listingPreviewBody .siteFlash') && css.includes('background:#b91c1c!important') && css.includes('border-radius:14px!important'));
check('preview controls use larger readable type', css.includes('font-size:14px!important') && css.includes('min-height:48px!important'));
check('desktop bar artwork removes the inline-image baseline gap', css.includes('line-height:0!important') && css.includes('display:block!important') && css.includes('vertical-align:middle!important') && css.includes('border-radius:22px 0 0 22px!important'));
check('listings page now requests schedules', /listings: new Set\(\[[\s\S]*?'schedules'/.test(snapshot));
check('listing schedule query is bounded and date-scoped', snapshot.includes("page === 'listings'") && snapshot.includes('options.limit = 160'));
check('seat-map inventory limit scales with loaded departures', snapshot.includes('Math.max(1800') && snapshot.includes('scheduleIds.length') && snapshot.includes('* 120'));
check('listing projection emits partner, inventory, route, badge and price cells', projection.includes("company?.name || listing.partner || '-'") && projection.includes('inventoryLabel') && projection.includes('routeOrLocation') && projection.includes('formatMoney(listingFareFrom'));
check('legacy schedule listing ownership can be resolved safely', scope.includes('routeListingById') && scope.includes('vehicleListingById') && scope.includes('resolvedListingId'));
check('vehicle conflicts require operator action instead of timed hot retries', model.includes('materializationRequiresAction') && materializer.includes('requiresAction') && materializer.includes('materializationRequiresAction: true'));
check('editing or resuming clears the action blocker', departureService.includes("materializationRequiresAction: ''") && departureService.includes('clearScheduleRuleMaterializationBlocker'));
check('Mongo outage pauses one global rolling queue', materializer.includes('pauseMongoQueue') && materializer.includes('Rolling departure queue paused because MongoDB is unavailable') && materializer.includes('backgroundQueue.set(key, job)'));
check('rolling repair scans are no longer five-minute hot scans', materializer.includes('BACKGROUND_REPAIR_INTERVAL_MS = 30 * 60 * 1000'));
check('scheduled jobs are staggered instead of launching together', scheduler.includes('staggerMs: 4200') && scheduler.includes('pendingLaunchTimers') && scheduler.includes('const launch = () =>'));
check('seat inventory warning explains missing persisted rows', seatMaps.includes('persisted seat rows are missing') && seatMaps.includes('rebuild only the missing inventory'));
if (!process.exitCode) console.log(`v1.6.16 preview/worker/listing checks passed (${passed}/18).`);

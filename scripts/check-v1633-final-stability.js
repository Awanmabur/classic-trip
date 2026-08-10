
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const catalog = read('src/services/marketplace/catalogService.js');
const home = read('src/views/pages/home.ejs');
const search = read('src/views/pages/search.ejs');
const marketJs = read('public/js/marketplace-db-search.js');
const companyController = read('src/controllers/company/dashboardController.js');
const companyRoutes = read('src/routes/web/company.js');
const shell = read('src/services/dashboard/shellConfig.js');
const notificationRoutes = read('src/routes/api/notifications.js');
const notificationJs = read('public/js/notifications.js');
const notificationSection = read('src/views/dashboards/shared/sections/notifications.ejs');
const customerNotificationSection = read('src/views/dashboards/shared/sections/customer-notifications.ejs');
const materializer = read('src/jobs/materializeSchedules.js');
const busService = read('src/modules/bus/services/busDepartureService.js');
let passed = 0;
function check(label, ok) {
  if (!ok) { console.error(`✗ ${label}`); process.exitCode = 1; }
  else { passed += 1; console.log(`✓ ${label}`); }
}
check('release version matches current package', pkg.version === '1.6.40');
check('bus search matches every DB route, not only first listing route', catalog.includes('function matchingBusRoute') && catalog.includes('const routes = Array.isArray(item.routes) ? item.routes : []') && catalog.includes('rows = rows.map((item) => withMatchedBusRoute(item, query))'));
check('bus search validates selected date against live route departures', catalog.includes('route.departures || []') && catalog.includes('isoDateInTimeZone(departure.departAt'));
check('bus search options contain only routes with live departures', catalog.includes('liveBusRouteIds') && catalog.includes('liveBusRouteIds.has'));
check('home bus From/To use DB pairs', home.includes('data-route-pair-container') && home.includes('data-route-pairs-json'));
check('general search can switch safely into DB-backed bus pairs', search.includes(`/js/marketplace-db-search.js?v=${pkg.version}`) && marketJs.includes("service.value).toLowerCase() === 'bus'") && marketJs.includes('pairs.filter'));
check('company notifications route is explicit and allowed', companyRoutes.includes("router.get('/company/notifications'") && companyController.includes("page === 'archive' || page === 'notifications'"));
check('all dashboard roles have notification href mapping', ['admin','customer','promoter','employee','driver','support','finance','operations','content'].every((role) => shell.includes(`roleKey === '${role}'`)));
check('notification API includes content admin and canonical staff aliases', notificationRoutes.includes("'content_admin'") && notificationRoutes.includes("'company_employee'") && notificationRoutes.includes("'support_admin'"));
check('notification pages use live API-driven list', notificationJs.includes("api('/api/notifications?limit=50')") && notificationJs.includes('data-ct-notification-page-list') && notificationSection.includes('data-ct-notification-page-list') && customerNotificationSection.includes('data-ct-notification-page-list'));
check('vehicle conflict blocker does not freeze a whole rolling rule', materializer.includes("if (rule.materializationBlockerCode === 'vehicle_schedule_conflict') return null") && !materializer.includes('await persistVehicleConflictBlocker(rule'));
check('rolling preflight skips conflict dates and scans later dates', materializer.includes('for (const departAt of missingDates)') && materializer.includes('vehicleConflictsFromRows(conflictRows, departAt, arriveAt)') && materializer.includes('if (conflicts.length)') && materializer.includes('continue;'));
check('initial rolling batch cannot recreate a skipped conflict date', materializer.includes('const canUseInitialContiguousBatch') && materializer.includes('skipped === 0') && materializer.includes('coveredByExistingDeparture === 0'));
check('new active recurring rules reject obvious vehicle overlaps', busService.includes('async function assertNoRecurringVehicleRuleConflict') && busService.includes("'vehicle_schedule_rule_conflict'"));
check('rolling warning clearly distinguishes deferred dates from fully blocked windows', materializer.includes('Rolling departure date deferred; later free dates continue materializing') && materializer.includes('Rolling window has no free missing date for this vehicle'));
if (!process.exitCode) console.log(`Final stability checks passed (${passed}/${passed}).`);

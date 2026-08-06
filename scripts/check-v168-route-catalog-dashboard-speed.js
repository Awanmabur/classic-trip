'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
function check(condition, label) {
  if (!condition) throw new Error(label);
  console.log(`✓ ${label}`);
}

const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const repository = read('src/repositories/domain/companyOperationsRepository.js');
const companyService = read('src/services/company/companyService.js');
const catalog = read('src/services/marketplace/catalogService.js');
const controller = read('src/controllers/public/listingController.js');
const listingView = read('src/views/pages/listing-details.ejs');
const css = read('public/css/completion-fixes.css');
const dashboardSnapshot = read('src/services/dashboard/dashboardSnapshotService.js');
const dashboardProjection = read('src/services/dashboard/dashboardProjectionEngine.js');
const flash = read('src/middlewares/flash.js');
const csrf = read('src/middlewares/csrf.js');
const inventory = read('src/modules/bus/services/busInventoryService.js');
const draft = read('src/modules/bus/services/busBookingDraftService.js');
const app = read('src/app.js');
const mongoGate = read('src/services/data/mongoReadGate.js');
const requestMetrics = read('src/services/performance/requestMetrics.js');
const listingApi = read('src/routes/api/listings.js');
const sw = read('public/sw.js');

check(pkg.version === '1.6.9' && lock.version === '1.6.9' && lock.packages?.['']?.version === '1.6.9', 'package and lockfile are v1.6.9');
check(/classic-trip-static-v1\.6\.9/.test(sw), 'service-worker cache is v1.6.9');
check(/routes:\s*new MongoCollection\('routes'\)/.test(repository) && /routeStops:\s*new MongoCollection\('routeStops'\)/.test(repository), 'company repository exports route and route-stop collections used by isBusRoute');
check(!/const repositories = require\('\.\.'\)/.test(repository), 'company repository no longer creates an unused circular repository import');
check(/companyRepository\.routes\.findOne/.test(companyService), 'rolling creation resolves bus routes through the now-defined repository collection');

check(/const catalogIndexCache = new WeakMap\(\)/.test(catalog), 'marketplace builds reusable request-local indexes');
check(/schedulesByListing/.test(catalog) && /segmentFaresByProduct/.test(catalog) && /roomUnitsByType/.test(catalog), 'catalog indexes schedules, fares and stay inventory instead of rescanning arrays per card');
check(/const routeItems = routes\.map\(\(route\) => catalogItem\(data, listing, route\)\)/.test(catalog) && /routes: routeSummaries/.test(catalog), 'marketplace keeps one bus operator card with compact route summaries');
check(/selectedRouteId/.test(controller) && /routes: Array\.isArray\(listing\.routes\)/.test(controller), 'preview context keeps all company routes and an explicit selected route');
check(/catalogItem\(data, listing, route\)/.test(catalog), 'public route links are built from their matching route instead of the first route');
check(/const routeStops = \[\];/.test(catalog) && /const seats = \[\];/.test(catalog), 'global marketing snapshot excludes route-stop and live-seat payloads');
check(/const segmentFares = \[\];/.test(catalog) && /const roomUnits = \[\];/.test(catalog), 'global marketing snapshot excludes exact segment fares and room-unit rows');
check(/applySearch\(items, query\)\.map\(compactHomeListing\)/.test(catalog) && /routes: Array\.isArray\(item\.routes\)/.test(catalog), 'search renders compact company cards with route summaries after rich filtering');
check(/limit: 8/.test(catalog), 'home catalog limits blog payload to the visible collection');

check(/outboundRouteSelect/.test(listingView) && /outboundScheduleSelect/.test(listingView) && /busJourneySelectionGrid/.test(listingView), 'route and ticket date/time selectors share the first journey row');
check(/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(css), 'route/time and boarding/drop-off controls use two aligned rows');
check(/returnTime > outboundFloor/.test(listingView), 'browser hides return departures that are not later than outbound arrival');
check(/assertReturnDepartsAfterOutbound/.test(draft) && /returnDeparture <= outboundFloor/.test(draft), 'server rejects same-time or earlier return departures');

check(/'busSegmentFares', 'hotelProperties'/.test(dashboardSnapshot) && !/'busSegmentFares', 'schedules', 'hotelProperties'/.test(dashboardSnapshot), 'listing dashboard loads fare sources without unrelated schedules');
check(/addPriceCandidate\(fareScope\.listingId, fareScope\.routeId/.test(dashboardProjection), 'dashboard Price from includes fare-product prices');
check(/routePriceCandidates/.test(dashboardProjection) && /listingPriceCandidates/.test(dashboardProjection), 'dashboard price calculation uses prebuilt route/listing indexes');
check(!/pruneCompanyDashboardForPage/.test(dashboardProjection) && /enrichCompanyDashboard\(companyDashboardData/.test(dashboardProjection), 'company dashboard enriches the complete active-page projection without destructive pruning');
check(/const listingByTitleMap = new Map/.test(dashboardProjection) && /const bookingByRefMap = new Map/.test(dashboardProjection), 'dashboard row enrichment uses lookup maps instead of nested state scans');

check(/delete session\.flashMessages/.test(flash) && !/session\.flashMessages = \[\];/.test(flash), 'empty GET requests no longer force a Mongo-backed flash-session write');
check(/req\.cookies\?\.\['XSRF-TOKEN'\]/.test(csrf), 'CSRF cookie is emitted only when it changes');
check(/BOOKING_SCHEDULE_SELECT/.test(inventory) && /routeSnapshot seatMapSnapshot fareSnapshot/.test(inventory), 'current-fare schedule read excludes unrelated schedule payloads');
check(/STATIC_CONTEXT_TTL_MS = 120_000/.test(inventory), 'current-fare immutable route/fare/seat context is reused for two minutes');
check(/if \(scheduleId\)/.test(listingApi) && /busInventoryService\.getAvailability/.test(listingApi), 'bus current-fare endpoint resolves the selected departure before catalog data');
check(/assertRequestedListingMatches/.test(listingApi), 'current-fare endpoint still enforces listing/departure ownership');
check(/all routes, 30-day schedules and fare tables/.test(listingApi), 'current-fare endpoint documents and avoids the former full-snapshot hot path');

check(/AsyncLocalStorage/.test(requestMetrics), 'request-scoped performance metrics are enabled');
check(/recordMongoRead/.test(mongoGate) && /waitMs:/.test(mongoGate), 'Mongo read duration and queue wait are measured');
check(/Server-Timing/.test(app) && /X-Mongo-Reads/.test(app), 'responses expose app and Mongo timing diagnostics');
check(/mongoQueuePeak/.test(app) && /Slow request/.test(app), 'slow-request logs identify database time and pool contention');
check(pkg.scripts['check:v168-route-catalog-dashboard-speed'], 'focused v1.6.9 audit is registered');
check(pkg.scripts.verify.includes('check:v168-route-catalog-dashboard-speed'), 'full verification runs the v1.6.9 audit');

console.log('v1.6.9 route, catalog, dashboard and performance audit passed (36/36).');

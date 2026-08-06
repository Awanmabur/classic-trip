#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const repository = read('src/repositories/domain/companyOperationsRepository.js');
const materializer = read('src/jobs/materializeSchedules.js');
const catalog = read('src/services/marketplace/catalogService.js');
const controller = read('src/controllers/public/listingController.js');
const search = read('src/modules/bus/services/busSearchService.js');
const inventory = read('src/modules/bus/services/busInventoryService.js');
const projection = read('src/services/dashboard/dashboardProjectionEngine.js');
const snapshot = read('src/services/dashboard/dashboardSnapshotService.js');
const listingView = read('src/views/pages/listing-details.ejs');
const css = read('public/css/completion-fixes.css');
const sw = read('public/sw.js');
const homeScript = read('public/js/home.js');
const listingCard = read('src/views/partials/listing-card.ejs');

const checks = [];
const check = (label, condition) => checks.push({ label, ok: Boolean(condition) });

check('release and service-worker cache are v1.6.9', pkg.version === '1.6.9' && sw.includes('classic-trip-static-v1.6.9'));
check('company operations repository exposes the route collection used by isBusRoute', repository.includes("routes: new MongoCollection('routes')"));
check('company operations repository exposes route stops used by route-stop dispatch', repository.includes("routeStops: new MongoCollection('routeStops')"));
check('rolling runtime failures are bounded to three attempts', materializer.includes('const MAX_BACKGROUND_ATTEMPTS = 3') && materializer.includes('job.attempts < MAX_BACKGROUND_ATTEMPTS'));
check('exhausted rolling failures pause until the repair scan', materializer.includes('paused after bounded failures and will resume at the next repair scan'));
check('checkout snapshot loads only listing, company, add-ons and configuration', catalog.includes('async function loadCheckoutSnapshotFresh') && catalog.includes('compactPublicSnapshot') && catalog.includes('checkoutSnapshotCache'));
check('checkout cache is invalidated with marketplace mutations', catalog.includes('checkoutSnapshotCache.clear()'));
check('payment form uses the compact checkout context', controller.includes('publicCheckoutListingContext') && controller.includes('catalogService.checkoutSnapshot'));
check('payment form requests only held outbound and return seats in parallel', controller.includes('outboundAvailabilityPromise') && controller.includes('seatNumbers: source.selectedSeats') && controller.includes('Promise.all([outboundAvailabilityPromise, returnAvailabilityPromise])'));
check('payment rendering is rebuilt from the selected canonical departure', controller.includes('function busCheckoutCatalogContext') && controller.includes('scheduleCatalogPreview(data, schedule)'));
check('active hold reads use a compact projection', inventory.includes('const ACTIVE_HOLD_SELECT') && inventory.includes('select: ACTIVE_HOLD_SELECT'));
check('current fare reads only selected segment inventory fields', inventory.includes("select: 'id scheduleId segmentId segmentOrder seatNumber status lockedUntil holdId bookingRef'"));
check('identical current-fare calls are cached and deduplicated', inventory.includes('availabilityResultCache') && inventory.includes('availabilityResultInflight'));
check('homepage keeps one bus card and embeds every active route', catalog.includes('.flatMap((row) => catalogItemsForListing(data, row))') && catalog.includes('const routeItems = routes.map((route) => catalogItem(data, listing, route))') && catalog.includes('routes: routeSummaries'));
check('operator cards open route selection without forcing one route', catalog.includes('const publicUrl = `/listings/${publicServiceSlug(serviceType)}/${listing.slug || listingId}`') && catalog.includes('url: publicUrl'));
check('route cards keep a unique client identity after the initial four cards', homeScript.includes('function catalogKey(item)') && homeScript.includes('data-catalog-key="${escapeHtml(key)}"') && homeScript.includes('catalogKey(row) === String(card.dataset.catalogKey') && listingCard.includes('data-catalog-key="<%= listing.catalogKey'));
check('global marketing snapshot skips route stops, live seats, vehicles and dated room nights', catalog.includes('Route-stop labels, live seats, vehicle records and dated room nights belong') && catalog.includes('const routeStops = [];') && catalog.includes('const seats = [];') && catalog.includes('const vehicles = [];') && catalog.includes('const roomNights = [];'));
check('marketing schedules and fares use compact projections', catalog.includes('CATALOG_SCHEDULE_SELECT') && catalog.includes('CATALOG_SEGMENT_FARE_SELECT'));
check('homepage bootstrap is cached and deduplicated between public requests', catalog.includes('const HOME_BOOTSTRAP_TTL_MS = 30_000') && catalog.includes('homeBootstrapInflight') && catalog.includes('return homeBootstrap({ force: true })'));
check('homepage bootstrap does not duplicate listings inside companies, routes and featured payloads', catalog.includes('function compactHomeListing') && catalog.includes('const listings = richListings.map(compactHomeListing)') && catalog.includes('Do not duplicate every listing inside company, route and featured payloads') && !catalog.slice(catalog.indexOf('async function homeBootstrap'), catalog.indexOf('async function recordReferralClick')).includes('companies: data.companies'));
check('return departures are strictly after the outbound arrival/departure', search.includes('departAt: { $gt: departureFloor }') && search.includes('departAfter: sourceSchedule.arriveAt || sourceSchedule.departAt'));
check('return search avoids loading full seat and fare snapshots', search.includes('Only fetch compact fields') && search.includes('select:'));
check('browser independently rejects same-time return departures', listingView.includes('returnTime > outboundFloor'));
check('route/time and boarding/drop-off stay in two aligned rows', listingView.includes('outboundRouteSelect') && listingView.includes('outboundScheduleSelect') && css.includes('grid-template-columns:repeat(2,minmax(0,1fr))'));
check('dashboard listings page loads real bus fare sources without schedules', snapshot.includes("'verificationReviews', 'listings', 'routes', 'vehicles', 'fareProducts'") && snapshot.includes("'busSegmentFares', 'hotelProperties'") && !snapshot.includes("'busSegmentFares', 'schedules', 'hotelProperties'"));
check('dashboard preserves canonical fields after page-scoped reads', !snapshot.includes('DASHBOARD_LARGE_FIELD_EXCLUSIONS') && snapshot.includes('desiredCompanyEntities'));
check('dashboard price derivation is indexed once rather than filtered per row', projection.includes('const listingPriceCandidates = new Map()') && projection.includes('const routePriceCandidates = new Map()'));
check('listing table outputs the real Price from column before metadata', projection.includes('formatMoney(listingPrice, listing.currency || companyCurrency)'));
check('route inventory outputs route-scoped price before metadata', projection.includes('formatMoney(routePrice, listing.currency || companyCurrency)'));
check('full verification includes the v1.6.9 root-speed audit', pkg.scripts.verify.includes('npm run check:v168-root-speed'));

const failed = checks.filter((row) => !row.ok);
checks.forEach((row) => console.log(`${row.ok ? '✓' : '✗'} ${row.label}`));
if (failed.length) {
  console.error(`v1.6.9 route/rolling/payment/dashboard speed audit failed (${checks.length - failed.length}/${checks.length}).`);
  process.exit(1);
}
console.log(`v1.6.9 route/rolling/payment/dashboard speed audit passed (${checks.length}/${checks.length}).`);

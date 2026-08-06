#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [];
function check(name, condition) { checks.push({ name, ok: Boolean(condition) }); }

const pkg = JSON.parse(read('package.json'));
const materializer = read('src/jobs/materializeSchedules.js');
const worker = read('src/worker.js');
const start = read('scripts/start.js');
const server = read('src/server.js');
const envExample = read('.env.example');
const render = read('render.yaml');
const outbox = read('src/services/shared/outboxHandlers.js');
const scheduleController = read('src/controllers/company/scheduleController.js');
const inventory = read('src/modules/bus/services/busInventoryService.js');
const departure = read('src/modules/bus/services/busDepartureService.js');
const catalog = read('src/services/marketplace/catalogService.js');
const listingController = read('src/controllers/public/listingController.js');
const listingApi = read('src/routes/api/listings.js');
const listingPage = read('src/views/pages/listing-details.ejs');
const listingCard = read('src/views/partials/listing-card.ejs');
const css = read('public/css/completion-fixes.css');
const snapshots = read('src/services/dashboard/dashboardSnapshotService.js');
const flash = read('src/middlewares/flash.js');
const repository = read('src/repositories/mongoRepository.js');
const releaseCheck = read('scripts/check-final-home-payment-release.js');
const sw = read('public/sw.js');

check('Package and browser cache are v1.6.11', pkg.version === '1.6.11' && sw.includes('classic-trip-static-v1.6.11'));
check('Normal and dedicated-worker startup keep rolling work out of the web process',
  start.includes('const webRollingFallback = !runBackgroundWorker')
  && start.includes("nodeEnv !== 'production'")
  && start.includes("WEB_ROLLING_FALLBACK: webRollingFallback ? 'true' : 'false'")
  && start.includes("WEB_ROLLING_FALLBACK: 'false'"));
check('Production web fallback is explicit and disabled in the separate-worker blueprint',
  server.includes("env.nodeEnv === 'production' ? 'false' : 'true'")
  && envExample.includes('WEB_ROLLING_FALLBACK=false')
  && render.includes('key: WEB_ROLLING_FALLBACK'));
check('Only an explicitly started fallback/worker owns the in-memory rolling queue',
  materializer.includes('let backgroundQueueOwner = false')
  && materializer.includes('!cleanRuleId || !backgroundQueueOwner')
  && materializer.includes('backgroundQueueOwner = true')
  && materializer.includes('backgroundQueueOwner = false'));
check('Background rolling uses one dated departure per batch',
  materializer.includes('const BACKGROUND_BATCH_SIZE = 1') && outbox.includes('{ waitForLeaseMs: 5000, maxCreates: 1 }'));
check('Background rolling yields between batches',
  materializer.includes('const BACKGROUND_BATCH_PAUSE_MS = 4000') && materializer.includes('await sleep(BACKGROUND_BATCH_PAUSE_MS)'));
check('Worker waits for the redirect/request burst before startup repair', worker.includes('startupDelayMs: 10000'));
check('Rolling cache invalidation is delayed until the drain settles',
  materializer.includes('after the whole rolling drain') && materializer.includes('}, 5000);'));
check('Repeated publication blockers have a five-minute cooldown',
  materializer.includes('PUBLICATION_BLOCKER_COOLDOWN_MS = 5 * 60 * 1000')
  && materializer.includes('publicationBlockerCooldown.set(ruleKey'));
check('Permanent rolling errors do not hot-loop',
  materializer.includes('queue paused until the next repair scan')
  && materializer.includes('pending > 0 && skipped > 0'));
check('Rolling feedback names the background worker and keeps blocker text',
  scheduleController.includes('queued for the background rolling worker')
  && scheduleController.includes('Draft blockers:'));
check('Flash text no longer truncates the permit blocker mid-word', (flash.match(/slice\(0, 700\)/g) || []).length >= 2);
check('The formerly failing release assertion follows current no-hot-loop semantics',
  releaseCheck.includes('pending > 0 && created > 0') && releaseCheck.includes('pending > 0 && skipped > 0'));

check('Departure state survives the immediate hold-to-payment redirect', inventory.includes('const SCHEDULE_STATE_TTL_MS = 5000'));
check('Live availability uses immutable route, seat-map and fare snapshots',
  inventory.includes('contextFromScheduleSnapshots') && inventory.includes('snapshotBacked'));
check('Full-route fare avoids unnecessary detailed fare reads',
  inventory.includes('!fareRows.length && !fullPublishedJourney'));
check('Availability reads only the selected segment and selected seats when supplied',
  inventory.includes('segmentId: { $in: segmentIds }') && inventory.includes('inventoryFilter.seatNumber = { $in: requestedSeats }'));
check('New departures persist compact fare rows in the publication snapshot',
  departure.includes('fares: fares.map((row) => ({') && departure.includes('fareSnapshot: immutableSnapshot'));
check('Listing-scoped snapshots do not load compatibility Seat rows for every dated bus',
  catalog.includes('const seats = [];') && catalog.includes('every compatibility Seat row'));
check('Listing-scoped snapshots reuse route and fare publication snapshots',
  catalog.includes('snapshotStops') && catalog.includes('snapshotFareProducts') && catalog.includes('snapshotSegmentFares'));
check('Single-listing API requests use listing-scoped snapshots',
  (listingApi.match(/snapshotForListing/g) || []).length >= 3);
check('Payment/ticket listing lookup is scoped to one listing', listingController.includes('snapshotForListing(listingId)'));
check('Browser fare requests dedupe identical in-flight calls',
  listingPage.includes('activeAvailabilityKey === key && activeAvailabilityPromise'));
check('Boarding/drop-off changes are debounced before a network request',
  listingPage.includes('outboundJourneyDebounce') && listingPage.includes('setTimeout(() => onOutboundJourneyChange(changedId), 180)'));
check('Current fare remains visible during live confirmation',
  listingPage.includes('Current fare per seat') && listingPage.includes('journeyLiveCheck'));
check('Live fare request has a bounded timeout rather than loading forever', listingPage.includes('}, 8000);'));
check('Return departures load after outbound availability without blocking it',
  listingPage.includes('refreshReturnSchedules()') && listingPage.includes('.then(() => returnSchedulesData.length'));

check('Dashboard snapshots remain active-page scoped',
  snapshots.includes("context.activePage || 'overview'") && snapshots.includes('desiredCompanyEntities'));
check('Dashboard writes invalidate only affected tenant pages',
  flash.includes('companyDashboardPagesForMutation') && flash.includes('invalidateDashboardMutation'));
check('Repository reads support field projections',
  repository.includes('options.select') && repository.includes('.select(options.select)'));

check('Bar cards use a wider image column on desktop and phone',
  css.includes('grid-template-columns:190px minmax(0,1fr)') && css.includes('grid-template-columns:142px minmax(0,1fr)'));
check('The service and rating badges sit at opposite image-bottom edges',
  listingCard.indexOf('thumbBadge--type') < listingCard.indexOf('thumbBadge--rating')
  && css.includes('justify-content:space-between')
  && css.includes('.thumbBadge--type{margin-right:auto!important}')
  && css.includes('.thumbBadge--rating{margin-left:auto!important}'));
check('Phone bar description is a small one-line ellipsis',
  css.includes('font-size:9px!important') && css.includes('white-space:nowrap!important') && css.includes('text-overflow:ellipsis!important'));
check('Header, body, footer and phone bottom navigation use one shell width',
  css.includes('--ct-public-shell-width') && css.includes('.homePage .siteFooter') && css.includes('body.homePage > .bottomNav'));
check('Full verification includes this root repair audit',
  pkg.scripts.verify.includes('npm run check:root-performance-current-fare-rolling-ui'));

const failed = checks.filter((row) => !row.ok);
checks.forEach((row) => console.log(`${row.ok ? '✓' : '✗'} ${row.name}`));
if (failed.length) {
  console.error(`Root performance/current-fare/rolling/UI audit failed (${checks.length - failed.length}/${checks.length}).`);
  process.exit(1);
}
console.log(`Root performance/current-fare/rolling/UI audit passed (${checks.length}/${checks.length}).`);

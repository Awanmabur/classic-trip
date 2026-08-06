'use strict';

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const catalog = read('src/services/marketplace/catalogService.js');
const inventory = read('src/modules/bus/services/busInventoryService.js');
const listingController = read('src/controllers/public/listingController.js');
const listingApi = read('src/routes/api/listings.js');
const dashboardSnapshot = read('src/services/dashboard/dashboardSnapshotService.js');
const projection = read('src/services/dashboard/dashboardProjectionEngine.js');
const env = read('src/config/env.js');
const app = read('src/app.js');
const worker = read('src/jobs/materializeSchedules.js');
const css = read('public/css/completion-fixes.css');
const sw = read('public/sw.js');

let passed = 0;
function check(label, condition) {
  if (!condition) throw new Error(label);
  passed += 1;
  console.log(`✓ ${label}`);
}

check('release and browser cache are v1.6.11', pkg.version === '1.6.11' && sw.includes("classic-trip-static-v1.6.11"));
check('global catalog no longer loads every compatibility seat row', !catalog.includes('commerceRepository.seats.list'));
check('global and listing previews no longer hydrate room-night history', !catalog.includes('commerceRepository.roomNights.list'));
check('catalog reads use the shared higher-concurrency gate', catalog.includes('Math.min(8') && catalog.includes('mongoReadConcurrency'));
check('listing snapshots remain hot for normal navigation', catalog.includes('const LISTING_SNAPSHOT_TTL_MS = 300_000') && catalog.includes('const LISTING_SNAPSHOT_STALE_MS = 1_800_000'));
check('fare and seat previews deduplicate identical live reads', inventory.includes('const AVAILABILITY_CACHE_TTL_MS = 1500') && inventory.includes('availabilityInflight'));
check('selected listing and departure snapshots are reused for live fare reads', inventory.includes('scheduleRecord: prefetchedSchedule') && inventory.includes('listingRecord: prefetchedListing'));
check('preview controller passes its verified records to inventory', listingController.includes('scheduleRecord: requested') && listingController.includes('listingRecord: raw'));
check('availability API passes its verified records to inventory', listingApi.includes('const scheduleRecord = (data.schedules || [])') && listingApi.includes('listingRecord: raw'));
check('dashboard independent data starts in the first query wave', dashboardSnapshot.includes('const independentRelatedTasks = [') && dashboardSnapshot.includes('await Promise.all(['));
check('customer and promoter dashboard heads read concurrently', dashboardSnapshot.includes('const [user, notifications] = await Promise.all([') && dashboardSnapshot.includes('const [promoterUser, promoterNotifications] = await Promise.all(['));
check('dashboard snapshots and projections remain warm longer', env.includes("DASHBOARD_SNAPSHOT_TTL_MS', 180000") && projection.includes('const DASHBOARD_DATA_CACHE_MS = 60_000'));
check('development assets use a short browser cache', app.includes("public, max-age=300, stale-while-revalidate=60"));
check('rolling writes are lower priority than interactive requests', worker.includes('const BACKGROUND_BATCH_PAUSE_MS = 4000'));
check('phone bottom navigation has strongly rounded outer and item edges', css.includes('border-radius:34px!important') && css.includes('border-radius:22px!important'));

console.log(`v1.6.11 speed and rounded-navigation checks passed (${passed}/${passed}).`);

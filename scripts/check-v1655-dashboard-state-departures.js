#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const pkg = JSON.parse(read('package.json'));
let passed = 0;
function check(label, fn) { fn(); passed += 1; console.log(`✓ ${label}`); }

check('release is v1.6.55', () => assert(/^1\.6\.(?:5[5-9]|[6-9]\d|\d{3,})$/.test(pkg.version)));
check('dashboard mutations preserve the page that initiated the action', () => {
  const mw = read('src/middlewares/dashboardMutationState.js');
  assert(mw.includes("MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])"));
  assert(mw.includes('dashboardReturnPath(req)'));
  assert(mw.includes('res.redirect = function preserveDashboardPage'));
  assert(mw.includes('company|employee|driver|promoter|admin|operations|support|finance|content|account'));
  assert(read('src/app.js').includes('app.use(dashboardMutationState)'));
});
check('dashboard forms submit an explicit safe return path', () => {
  const js = read('public/js/dashboard-workspace.js');
  assert(js.includes("returnField.name = '_returnTo'"));
  assert(js.includes('window.location.pathname'));
});
check('successful dashboard writes invalidate dashboard and marketplace read models', () => {
  const mw = read('src/middlewares/dashboardMutationState.js');
  assert(mw.includes('dashboardSnapshotService.invalidate()'));
  assert(mw.includes('invalidateMarketplaceCache?.()'));
  const catalog = read('src/services/marketplace/catalogService.js');
  assert(catalog.includes("redisRuntime.key('listing-snapshot', '')"));
  assert(catalog.includes('invalidateSharedListingSnapshots'));
});
check('archived hotel records no longer reserve live unique relationships', () => {
  const service = read('src/services/hotel/hotelService.js');
  assert(service.includes("status: { $ne: 'archived' }"));
  const models = ['HotelProperty','RoomType','RoomUnit','RatePlan'];
  for (const name of models) {
    const files = fs.readdirSync(path.join(root, 'src', 'models')).filter((f) => f.toLowerCase().includes(name.toLowerCase()));
    assert(files.length, `missing ${name} model`);
    assert(files.some((f) => read(`src/models/${f}`).includes('partialFilterExpression')), `${name} lacks partial live unique index`);
  }
});
check('archived taxi records are excluded from create/upsert reuse', () => {
  const service = read('src/modules/taxi/services/taxiSetupService.js');
  assert(service.includes("status: { $ne: 'archived' }"));
  assert(service.includes("operationalStatus: { $ne: 'archived' }"));
});
check('archive uniqueness repair command exists for existing databases', () => {
  assert.strictEqual(pkg.scripts['repair:archive-uniqueness'], 'node scripts/repair-archive-uniqueness.js');
  const repair = read('scripts/repair-archive-uniqueness.js');
  assert(repair.includes('partialFilterExpression'));
  assert(repair.includes('BusSegmentFare'));
  assert(repair.includes('SeatMapTemplate'));
});
check('public bus catalog uses one future public departure set for preview and counts', () => {
  const catalog = read('src/services/marketplace/catalogService.js');
  assert(catalog.includes('const futureSchedules ='));
  assert(catalog.includes("['published', 'boarding', 'delayed']"));
  assert(catalog.includes('departureCount: serviceType === \'bus\' ? futureSchedules.length : 0'));
  assert(catalog.includes('routeSchedules = futureSchedules'));
});
check('bus badges represent departures rather than seat inventory', () => {
  const home = read('public/js/home.js');
  const view = read('src/views/partials/listing-card.ejs');
  assert(home.includes('departureCount'));
  assert(home.includes('No departures'));
  assert(view.includes('departureCount'));
  assert(view.includes('No departures'));
});
check('dashboard listing rows count only future public bus departures', () => {
  const engine = read('src/services/dashboard/dashboardProjectionEngine.js');
  assert(engine.includes('publicBusDepartures'));
  assert(engine.includes("['published', 'boarding', 'delayed']"));
  assert(engine.includes('public departure'));
});
check('published one-off creation is strict and cannot silently downgrade to draft', () => {
  const service = read('src/modules/bus/services/busDepartureService.js');
  assert(service.includes('strictPublishIntent'));
  assert(service.includes('preflightSchedulePublication'));
  assert(service.includes('options.strictPublish'));
  const controller = read('src/controllers/company/scheduleController.js');
  assert(controller.includes("strictPublishIntent: String(req.body?.status || '').toLowerCase() === 'published'"));
});
check('published batch creation preflights every requested date before writing', () => {
  const service = read('src/modules/bus/services/busDepartureService.js');
  const batch = service.slice(service.indexOf('async function createScheduleBatch'), service.indexOf('async function updateSchedule'));
  assert(batch.includes('strictPublish'));
  assert(batch.includes('preflightSchedulePublication'));
  assert(batch.includes('const failures = new Set()'));
  assert(batch.includes('if (failures.size)'));
});
check('published rolling creation preflights readiness before recurring rule creation', () => {
  const controller = read('src/controllers/company/scheduleController.js');
  const create = controller.slice(controller.indexOf('async function create('), controller.indexOf('async function update('));
  assert(create.indexOf('preflightSchedulePublication') < create.indexOf('createScheduleRule'));
  assert(create.includes('Published rolling departures are not ready'));
});
check('existing draft departures have a bulk publish-ready action', () => {
  const service = read('src/modules/bus/services/busDepartureService.js');
  const controller = read('src/controllers/company/scheduleController.js');
  const routes = read('src/routes/web/company.js');
  const view = read('src/views/dashboards/shared/sections/schedules.ejs');
  assert(service.includes('async function publishReadyDraftSchedules'));
  assert(controller.includes('async function publishReadyDrafts'));
  assert(routes.includes("/company/schedules/publish-ready-drafts"));
  assert(view.includes('Publish ready drafts'));
});
check('publish-ready route is declared before the generic schedule id route', () => {
  const routes = read('src/routes/web/company.js');
  assert(routes.indexOf('/company/schedules/publish-ready-drafts') < routes.indexOf("/company/schedules/:id'"));
});
check('draft departures remain private to operators until they pass publication validation', () => {
  const catalog = read('src/services/marketplace/catalogService.js');
  assert(catalog.includes("['published', 'boarding', 'delayed']"));
  assert(!catalog.includes("['published', 'boarding', 'delayed', 'draft']"));
});
check('semantic assets are cache-busted as v1.6.55', () => {
  assert(read('public/sw.js').includes(`classic-trip-static-v${pkg.version}`));
  assert(read('src/views/partials/site-head.ejs').includes(`v=${pkg.version}`));
});

console.log(`\n${passed}/17 v1.6.55 dashboard-state/departure checks passed.`);

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

check('release is v1.6.53 or newer', () => assert(Number(pkg.version.split('.')[2]) >= 53));
check('bus card does not repeat primary route or operator title', () => {
  const view = read('src/views/partials/listing-card.ejs');
  assert(view.includes('partnerRepeatsTitle'));
  assert(view.includes('if (!isBusListing)'));
  assert(view.includes('companyRouteList'));
});
check('home bus card uses the same no-repeat rule', () => {
  const js = read('public/js/home.js');
  assert(js.includes('partnerRepeatsTitle'));
  assert(js.includes("${!isBus ? `<span"));
});
check('bus price is From cheapest full route fare', () => {
  const catalog = read('src/services/marketplace/catalogService.js');
  const card = read('src/views/partials/listing-card.ejs');
  assert(catalog.includes("publishedRoutePrices = serviceType === 'bus' ? routeSummaries.map"));
  assert(catalog.includes('Math.min(...publishedRoutePrices)'));
  assert(card.includes('pricePrefix') && card.includes('priceCurrency'));
  assert(card.includes('Cheapest route fare'));
});
check('route chips stay swipeable with multi-row route presentation', () => {
  const css = read('public/css/completion-fixes.css');
  const home = read('public/js/home.js');
  assert(css.includes('overflow-x:auto!important'));
  assert(css.includes('.companyRouteLane'));
  assert(home.includes('const routeRows = 2;'));
});
check('server marketplace cards carry service identity classes', () => {
  const view = read('src/views/partials/listing-card.ejs');
  assert(view.includes('serviceCard serviceCard--<%= listingType %>'));
});
check('search and service pages reuse home service styles', () => {
  const css = read('public/css/completion-fixes.css');
  for (const type of ['bus','hotel','flight','local_transport','tour','car_rental','cargo']) assert(css.includes(`.sitePage .marketplaceListingCard.serviceCard--${type}`), type);
});
check('blog directory is four equal cards per desktop row', () => {
  const css = read('public/css/completion-fixes.css');
  const view = read('src/views/pages/blogs.ejs');
  assert(css.includes('.blogsPage .blogDirectoryGrid{grid-template-columns:repeat(4,minmax(0,1fr))!important}'));
  assert(!view.includes("index === 0 ? 'blogDirectoryCard--featured'"));
});
check('company bus Quick Actions open real dashboard pages', () => {
  const view = read('src/views/dashboards/shared/workspace.ejs');
  for (const href of ['/company/profile?create=branch','/company/listings?create=bus%20service','/company/listings?create=listing','/company/routes?create=route','/company/vehicles?create=vehicle','/company/schedules?create=schedule']) assert(view.includes(`href="${href}"`), href);
});
check('company stay Quick Actions open real dashboard pages', () => {
  const view = read('src/views/dashboards/shared/workspace.ejs');
  for (const href of ['/company/hotel-properties?create=hotel%20property','/company/room-types?create=room%20type']) assert(view.includes(`href="${href}"`), href);
});
check('real page can auto-open its full create form', () => {
  const js = read('public/js/dashboard-workspace.js');
  assert(js.includes("get('create')"));
  assert(js.includes("openCrud('create', createFromPage"));
  assert(js.includes("searchParams.delete('create')"));
});
check('schedule actions do not offer impossible lifecycle operations', () => {
  const js = read('public/js/dashboard-workspace.js');
  assert(js.includes("const scheduleStatus = String(meta?.status"));
  assert(js.includes("if (['draft','active'].includes(scheduleStatus))"));
  assert(js.includes("if (scheduleStatus === 'arrived')"));
});
check('published departure archive is safe and booking-aware', () => {
  const svc = read('src/modules/bus/services/busDepartureService.js');
  assert(svc.includes("const safelyArchivablePublic = ['published', 'delayed']"));
  assert(svc.includes('departureHasPassengerActivity(companyId, schedule.id)'));
  assert(svc.includes("eventType: 'BusDepartureArchived'"));
  assert(svc.includes("eventType: 'ScheduleRuleMaterializationRequested'"));
});
check('production APP_URL validation keeps appUrl in Pesapal scope', () => {
  const env = read('src/config/env.js');
  assert(env.includes('let appUrl = null;'));
  assert(!env.includes('if (env.isProduction) {\n    let appUrl;'));
  assert(env.includes("pesapalCallback.hostname.toLowerCase() !== appUrl.hostname.toLowerCase()"));
});
check('notification mutations use the current CSRF cookie', () => {
  const js = read('public/js/notifications.js');
  assert(js.includes("XSRF-TOKEN="));
  assert(js.includes('decodeURIComponent'));
});
check('semantic browser assets match current release', () => {
  assert(read('public/sw.js').includes(`classic-trip-static-v${pkg.version}`));
  assert(read('src/views/pages/search.ejs').includes(`marketplace-db-search.js?v=${pkg.version}`));
});
console.log(`\n${passed}/16 v1.6.53 marketplace/actions checks passed.`);

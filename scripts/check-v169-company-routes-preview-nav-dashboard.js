#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const catalog = read('src/services/marketplace/catalogService.js');
const controller = read('src/controllers/public/listingController.js');
const preview = read('src/views/pages/listing-details.ejs');
const card = read('src/views/partials/listing-card.ejs');
const home = read('public/js/home.js');
const css = read('public/css/completion-fixes.css');
const projection = read('src/services/dashboard/dashboardProjectionEngine.js');
const snapshot = read('src/services/dashboard/dashboardSnapshotService.js');
const sw = read('public/sw.js');

const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

check('package and lockfile are v1.6.9', pkg.version === '1.6.9' && lock.version === '1.6.9' && lock.packages?.['']?.version === '1.6.9');
check('service worker uses the v1.6.9 cache', sw.includes('classic-trip-static-v1.6.9'));
check('bus catalog builds route summaries under one listing card', catalog.includes('const routeItems = routes.map((route) => catalogItem(data, listing, route))') && catalog.includes('routes: routeSummaries'));
check('bus catalog returns one aggregate item instead of route item array', catalog.includes('return [{') && catalog.includes('routeId: \'\'') && catalog.includes('catalogKey: listingId'));
check('aggregate bus card opens preview without a forced route query', catalog.includes('const publicUrl = `/listings/${publicServiceSlug(serviceType)}/${listing.slug || listingId}`'));
check('compact homepage payload retains route choices', catalog.includes('routes: Array.isArray(item.routes) ? item.routes.map'));
check('route-aware search checks every route origin', catalog.includes("(item.routes || []).map((route) => route.origin).join(' ')"));
check('route-aware search checks every route destination', catalog.includes("(item.routes || []).map((route) => route.destination).join(' ')"));
check('homepage route highlights expand compact routes without duplicating cards', catalog.includes("const routeRows = item.serviceType === 'bus' && Array.isArray(item.routes)"));
check('server-rendered cards show every company route', card.includes('companyRouteList') && card.includes('companyRoutes.forEach'));
check('client-rendered cards show every company route', home.includes('function companyRoutesHtml') && home.includes('item.routes.map'));
check('route list remains horizontally available instead of being truncated away', css.includes('.companyRouteList') && css.includes('overflow-x:auto'));

check('preview receives explicit selected route context', controller.includes('selectedRouteId') && controller.includes('routes: Array.isArray(listing.routes)'));
check('preview has a company route selector', preview.includes('id="outboundRouteSelect"') && preview.includes('data-listing-action="outbound-route"'));
check('route selector is opposite the travel date/time selector', preview.indexOf('id="outboundRouteSelect"') < preview.indexOf('id="outboundScheduleSelect"') && css.includes('grid-template-columns:repeat(2,minmax(0,1fr))'));
check('boarding and drop-off selectors remain together below route/time', preview.indexOf('id="outboundOriginStopSelect"') < preview.indexOf('id="outboundDestinationStopSelect"'));
check('schedule choices are filtered by selected route', preview.includes('function schedulesForActiveRoute()') && preview.includes("String(schedule.routeId || '') === String(activeRouteId)"));
check('ticket-class counts are recalculated per route', preview.includes('function syncRouteTicketClasses()') && preview.includes('standardTicketCount'));
check('route changes reset stale schedule, fare and seat state', preview.includes('async function onOutboundRouteChange()') && preview.includes('await onOutboundScheduleChange()'));
check('route selection is preserved in the preview URL without a reload', preview.includes("url.searchParams.set('routeId', activeRouteId)") && preview.includes('window.history.replaceState'));
check('boarding and drop-off controls wait for a real departure', preview.includes('Select travel time first') && preview.includes('control.disabled = true'));
check('same-time return trips remain rejected', preview.includes('returnTime > outboundFloor'));

check('homepage top header uses the same public shell width as body', css.includes('body.homePage > header.nav') && css.includes('--ct-public-shell-width:calc(100% - 12px)'));
check('phone bottom navigation is explicitly centered', css.includes('left:50%!important') && css.includes('transform:translateX(-50%)!important'));
check('phone bottom navigation uses five equal columns', css.includes('grid-template-columns:repeat(5,minmax(0,1fr))!important'));
check('phone bottom navigation buttons cannot overflow their columns', css.includes('body.homePage > .bottomNav button') && css.includes('min-width:0!important'));

check('dashboard no longer prunes arrays before enrichment', !projection.includes('pruneCompanyDashboardForPage') && projection.includes('enrichCompanyDashboard(companyDashboardData'));
check('dashboard listings page does not load unrelated schedules', snapshot.includes("'busSegmentFares', 'hotelProperties'") && !snapshot.includes("'busSegmentFares', 'schedules', 'hotelProperties'"));
check('dashboard canonical fields are not removed by global negative projections', !snapshot.includes('DASHBOARD_LARGE_FIELD_EXCLUSIONS'));
check('dashboard reads remain active-page scoped', snapshot.includes('desiredCompanyEntities') && snapshot.includes("context.activePage || 'overview'"));
check('focused v1.6.9 audit is registered', Boolean(pkg.scripts['check:v169-company-routes-preview-nav-dashboard']));
check('full verification includes the focused v1.6.9 audit', pkg.scripts.verify.includes('check:v169-company-routes-preview-nav-dashboard'));

checks.forEach((row) => console.log(`${row.ok ? '✓' : '✗'} ${row.name}`));
const failed = checks.filter((row) => !row.ok);
if (failed.length) {
  console.error(`v1.6.9 company route, preview, navigation and dashboard audit failed (${checks.length - failed.length}/${checks.length}).`);
  process.exit(1);
}
console.log(`v1.6.9 company route, preview, navigation and dashboard audit passed (${checks.length}/${checks.length}).`);

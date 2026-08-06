'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
let passed = 0;
function check(label, fn) { fn(); passed += 1; console.log(`✓ ${label}`); }

const card = read('src/views/partials/listing-card.ejs');
const homeJs = read('public/js/home.js');
const homeCss = read('public/css/pages/home.css') + '\n' + read('public/css/four-service-ui.css');
const home = read('src/views/pages/home.ejs');
const header = read('src/views/partials/site-header.ejs');
const dashboard = read('public/js/dashboard-workspace.js');
const dashboardCss = read('public/css/completion-fixes.css');
const contentRules = read('src/config/contentRules.js');
const companyService = read('src/services/company/companyService.js');
const busSetup = read('src/modules/bus/services/busSetupService.js');
const hotelService = read('src/services/hotel/hotelService.js');
const busInventory = read('src/modules/bus/services/busInventoryService.js');
const details = read('src/views/pages/listing-details.ejs');
const app = read('src/app.js');
const sw = read('public/sw.js');
const pwa = read('public/js/pwa.js');
const siteHead = read('src/views/partials/site-head.ejs');
const manifest = JSON.parse(read('public/site.webmanifest'));

check('bus card uses the compact one-line fare hint', () => {
  assert(card.includes('Fare by stops'));
  assert(homeJs.includes('Fare by stops'));
  assert(!card.includes('Starting fare · choose boarding and drop-off'));
});
check('card descriptions use exactly a three-line preview', () => {
  assert(homeCss.includes('-webkit-line-clamp:3'));
  assert(homeCss.includes('min-height:52px'));
  assert(homeCss.includes('max-height:52px'));
});
check('fare hint cannot wrap below the price', () => assert(homeCss.includes('white-space:nowrap') && homeCss.includes('text-overflow:ellipsis')));
check('public listing description minimum is 125 characters', () => assert(contentRules.includes('LISTING_DESCRIPTION_MIN_LENGTH = 125')));
check('partner listing form displays minimum and live count', () => assert(dashboard.includes('minLength:125') && dashboard.includes('fieldCharacterCount') && dashboard.includes('Minimum 125 characters')));
check('terminal selection reuses city country and address', () => assert(dashboard.includes('Select the operating terminal once. Its city, country and address are reused automatically.')));
check('company listings enforce the public description server-side', () => assert(companyService.includes('assertPublicDescription') && companyService.includes('LISTING_DESCRIPTION_MIN_LENGTH')));
check('bus listings enforce the public description server-side', () => assert(busSetup.includes('assertPublicDescription') && busSetup.includes('LISTING_DESCRIPTION_MIN_LENGTH')));
check('stay listings enforce description readiness', () => assert(hotelService.includes('LISTING_DESCRIPTION_MIN_LENGTH') && hotelService.includes('listing_description_missing')));
check('mobile profile drawer places categories after navigation', () => {
  assert(home.indexOf('class="drawerFilters"') > home.indexOf('class="drawerLinks"'));
  assert(header.indexOf('staticDrawerFilters') > header.indexOf('class="drawerLinks"'));
  ['Airbnb homes','Tours','Car rentals','Cargo'].forEach((label) => assert(header.includes(label)));
});
check('phone dashboard statistics are forced to two columns', () => assert(dashboardCss.includes('.dashboardBody .statsGrid') && dashboardCss.includes('grid-template-columns:repeat(2,minmax(0,1fr))!important')));
check('bus schedule context fetches independent records in parallel', () => assert(busInventory.includes('await Promise.all([') && busInventory.includes('repository.segmentFares.list')));
check('read-only availability no longer expires all holds synchronously', () => {
  const body = busInventory.slice(busInventory.indexOf('async function getAvailability'), busInventory.indexOf('async function recalculateCompatibilitySeat'));
  assert(!body.includes('await expireStaleHolds'));
});
check('expired display holds are treated as available while checkout expires only selected stale holds', () => {
  assert(busInventory.includes("row.status === 'held' && new Date(row.lockedUntil).getTime() <= Date.now() ? 'available'"));
  const holdBody = busInventory.slice(busInventory.indexOf('async function holdSeats'), busInventory.indexOf('async function assertActiveHold'));
  assert(!holdBody.includes('await expireStaleHolds();'));
  assert(holdBody.includes('staleSelectedHoldIds'));
  assert(holdBody.includes("await releaseHold(staleHoldId, 'expired', 'checkout-targeted-expiry')"));
});
check('journey requests cancel stale responses and use short-lived caches', () => {
  assert(details.includes('new AbortController()'));
  assert(details.includes('Date.now() + 5000'));
  assert(details.includes('Date.now() + 30000'));
  assert(details.includes('outboundRequestSequence'));
});
check('return schedules load only when return travel is enabled', () => assert(details.includes("document.getElementById('returnTripToggle')?.checked")));
check('static assets receive production caching and image lazy loading', () => {
  assert(app.includes("maxAge: env.isProduction ? '30d' : 0"));
  assert(app.includes('immutable: env.isProduction'));
  assert(card.includes('loading="lazy"') && card.includes('decoding="async"'));
});
check('only one native splash path remains', () => assert(!/pwaLaunchFlash|showBrandLaunchFlash|classicTripLaunchSplash/.test(pwa + siteHead)));
check('native splash lockups include logo name and slogan', () => {
  assert(manifest.name === 'Classic Trip');
  assert(manifest.description.includes('Move, stay and fly with confidence'));
  assert(manifest.icons.some((icon) => icon.src === '/images/launch-lockup-192.png'));
  assert(manifest.icons.some((icon) => icon.src === '/images/launch-lockup-512.png'));
  assert(fs.existsSync(path.join(root, 'public/images/launch-lockup-192.png')));
  assert(fs.existsSync(path.join(root, 'public/images/launch-lockup-512.png')));
});
check('service worker deploys the new launch assets and cache version', () => assert(sw.includes(`classic-trip-static-v${pkg.version}`) && sw.includes('launch-lockup-192.png') && sw.includes('launch-lockup-512.png')));

console.log(`Final speed, content, drawer and splash checks passed: ${passed}/20`);

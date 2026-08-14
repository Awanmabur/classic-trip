#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
let passed = 0;
function check(label, fn) {
  try { fn(); passed += 1; console.log(`✓ ${label}`); }
  catch (error) { console.error(`✗ ${label}: ${error.message}`); process.exitCode = 1; }
}
const pkg = JSON.parse(read('package.json'));
const home = read('src/views/pages/home.ejs');
const homeJs = read('public/js/home.js');
const catalog = read('src/services/marketplace/catalogService.js');
const css = `${read('public/css/pages/home.css')}\n${read('public/css/completion-fixes.css')}`;
const listing = read('src/views/pages/listing-details.ejs');
const footer = read('src/views/partials/site-footer-markup.ejs');
const siteFooter = read('src/views/partials/site-footer.ejs');
const blogController = read('src/controllers/public/blogController.js');
const env = read('src/config/env.js');

check('release is v1.6.80', () => assert.strictEqual(pkg.version, '1.6.80'));
check('all seven home marketplace card sections SSR six cards', () => {
  const slices = [...home.matchAll(/initial(?:Bus|Hotel|Flight|Taxi|Tour|Rental|Cargo)Listings\s*=.*?\.slice\(0,\s*6\)/g)];
  assert.strictEqual(slices.length, 7);
});
check('home Cards show six and Bars show four independently', () => {
  assert(homeJs.includes("viewLimits = Object.freeze({ cards: 6, bars: 4 })"));
  assert(homeJs.includes('visibleCounts[group][view]'));
  assert(homeJs.includes('incrementFor(view)'));
});
check('More actions stay bottom-right', () => assert(css.includes('justify-content:flex-end!important') && home.includes('More promoted services') && home.includes('More blogs')));
check('country-route filter filters bus rows including nested routes', () => {
  assert(homeJs.includes("group === 'bus' && activeCorridor !== 'all'"));
  assert(homeJs.includes('routes.flatMap((route) => [routeCountryCorridor(route), route?.countryCorridor, route?.corridor])'));
  assert(catalog.includes('const corridor = canonicalCorridor(query.corridor || query.route || query.countryRoute)'));
  assert(catalog.includes('item.routes.flatMap((route) => [route.countryCorridor, route.corridor])'));
});
check('bus amenities derive uniquely from vehicles assigned to live departures', () => {
  assert(catalog.includes('publicVehicleIds'));
  assert(catalog.includes("select: 'id listingId amenities status'"));
  assert(catalog.includes('seenAmenityKeys'));
  assert(catalog.includes('amenities: publicAmenities'));
});
check('public discovery still avoids seat/room-night bulk reads', () => {
  const start = catalog.indexOf('async function loadDiscoverySnapshotFresh()');
  const end = catalog.indexOf('async function readSharedDiscoverySnapshot()', start);
  const discovery = catalog.slice(start, end);
  assert(!discovery.includes('commerceRepository.seats.list'));
  assert(!discovery.includes('commerceRepository.roomNights.list'));
  assert(!discovery.includes('commerceRepository.roomUnits.list'));
});
check('listing preview context spans the sheet width on phone', () => {
  assert(listing.includes('<div class="sheetTopPrimary">'));
  assert(listing.includes('<div class="sheetSub" id="modalSub">'));
  assert(css.includes('.listingPreviewPage .sheetTop > .sheetSub'));
  assert(css.includes('grid-column:1/-1!important'));
});
check('public marketplace noise/background texture is removed', () => assert(css.includes('.homePage::before') && css.includes('.sitePage::before') && css.includes('content:none!important')));
check('one canonical public footer is used by home and normal public pages', () => {
  assert(home.includes("include('../partials/site-footer-markup')"));
  assert(siteFooter.includes("include('site-footer-markup')"));
  assert(!home.includes('<footer class="siteFooter">'));
  assert(footer.includes('<h3>Explore</h3>') && footer.includes('<h3>Bookings &amp; account</h3>') && footer.includes('<h3>Partners</h3>') && footer.includes('<h3>Help &amp; legal</h3>'));
});
check('shared footer has contact/social icons and optional official social URLs', () => {
  assert(footer.includes('footerSocialIcon'));
  for (const icon of ['fa-whatsapp','fa-envelope','fa-phone','fa-facebook-f','fa-instagram','fa-x-twitter','fa-tiktok','fa-youtube','fa-linkedin-in']) assert(footer.includes(icon), icon);
  assert(env.includes('SOCIAL_FACEBOOK_URL') && env.includes('SOCIAL_INSTAGRAM_URL') && env.includes('SOCIAL_LINKEDIN_URL'));
});
check('blog preview keeps original split layout with content-sized header and bounded media', () => {
  assert(css.includes('.blogPostHeader{grid-template-columns:minmax(0,1.08fr) minmax(320px,.92fr);min-height:0;align-items:stretch}'));
  assert(css.includes('.blogPostHeroMedia{min-height:0;height:auto;position:relative;overflow:hidden;background:var(--field)}'));
  assert(css.includes('.blogPostHeroMedia img,.blogPostHeroMedia .blogDirectoryPlaceholder{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}'));
  assert(css.includes('@media(max-width:1000px){.blogPostHeader{grid-template-columns:1fr}.blogPostHeroMedia{height:clamp(220px,46vw,320px)}}'));
});
check('blog preview loads four related guides in a four-column desktop row', () => assert(blogController.includes("limit: 4 })).map") && css.includes('.blogDirectoryGrid--related{grid-template-columns:repeat(4,minmax(0,1fr))}')));
check('preview actions remain top-right while context occupies its own row', () => {
  assert(css.includes('grid-template-columns:minmax(0,1fr) auto!important'));
  assert(css.includes('grid-column:2!important'));
  assert(css.includes('grid-row:1!important'));
});
check('preview hero images are height-bounded and cropped rather than stretching layout', () => {
  assert(css.includes('max-height:230px!important'));
  assert(css.includes('object-fit:cover!important'));
});
check('country routes use terminal-country metadata with legacy city fallback', () => {
  assert(catalog.includes('companyOperationsRepository.branches.list'));
  assert(catalog.includes('countryCorridor: countryMeta.countryCorridor'));
  assert(homeJs.includes('routeCountryCorridor(route)'));
  assert(homeJs.includes("'juba','nimule'"));
});
check('local .env is allowed for release checks but remains git-ignored', () => {
  const productionCheck = read('scripts/check-production-architecture.js');
  assert(!productionCheck.includes("'.env', '.claude'"));
  assert(productionCheck.includes('Local .env must be excluded by .gitignore'));
});
check('service worker cache matches current release', () => assert(read('public/sw.js').includes(`classic-trip-static-v${pkg.version}`)));
if (!process.exitCode) 
check('Stay bar media stretches to the full row height', () => {
  assert(css.includes('v1.6.80: Stay bars must use the same full-height media column'));
  assert(css.includes('height:auto!important'));
  assert(css.includes('height:100%!important'));
});
check('Stay listing media fills the full card frame and has a local fallback', () => {
  assert(css.includes('Stay media must fill the complete card media frame.'));
  assert(css.includes('serviceCard--hotel .thumb img'));
  assert(read('src/views/partials/listing-card.ejs').includes("/images/stays/stay-fallback.svg"));
});
console.log(`\n${passed}/${passed} public layout/content checks passed.`);

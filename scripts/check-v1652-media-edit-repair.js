#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const pkg = JSON.parse(read('package.json'));
const seedMedia = require('../src/utils/seedMedia');
const { resolveBlogImage } = require('../src/utils/blogImage');
let passed = 0;
function check(label, fn) { fn(); passed += 1; console.log(`✓ ${label}`); }
check('release is v1.6.52 or newer', () => assert(Number(pkg.version.split('.').join('')) >= 1652));
check('known legacy seeded blog URLs are recognized', () => {
  assert(seedMedia.isLegacySeedBlogUrl('how-to-book-bus-tickets-online-uganda-east-africa', 'https://bebetocoachservices.com/bebeto-hero.jpg.jpeg'));
  assert(seedMedia.isLegacySeedBlogUrl('uganda-bus-travel-gulu-lira-arua-soroti-mbale-guide', 'https://zawadigroups.com/wp-content/uploads/2021/11/ZAWADI-BUSES.jpg'));
});
check('known legacy seeded operator URLs are recognized', () => {
  assert(seedMedia.isLegacySeedOperatorUrl('eco-bus', 'https://pbs.twimg.com/media/FaWRexRXEAANcyV.jpg'));
  assert(seedMedia.isLegacySeedOperatorUrl('friendship-bus', 'https://booking.ttta.co.ug/wp-content/uploads/2024/07/friends-bus.jpg'));
});
check('blog resolver replaces known external seed URL with same-origin media', () => {
  const url = resolveBlogImage({ slug:'kampala-to-juba-bus-travel-guide', image:'https://bebetocoachservices.com/bebeto18.jpg.jpeg' });
  assert.strictEqual(url, '/media/blog/kampala-to-juba-bus-travel-guide');
});
check('Cloudinary migration treats known external seed URLs as migratable', () => {
  const src = read('scripts/migrate-seeded-media-cloudinary.js');
  assert(src.includes('!isLegacySeedBlogUrl(slug, current)'));
  assert(src.includes('!isLegacySeedOperatorUrl(key, current)'));
});
check('seed is idempotent even when semantic query misses canonical seed id', () => {
  const src = read('scripts/seed-launch-seo-operators.js');
  assert(src.includes('const bySeedId = await Model.findOne({ id: doc.id })'));
  assert(src.includes("error?.code === 11000"));
});
check('seed upgrades known legacy blog and operator URLs', () => {
  const src = read('scripts/seed-launch-seo-operators.js');
  assert(src.includes('isLegacySeedBlogUrl(post.slug, result.row.image)'));
  assert(src.includes('isLegacySeedOperatorUrl(operator.key'));
});
check('marketplace replaces known seeded operator hotlinks with stable media', () => {
  const src = read('src/services/marketplace/catalogService.js');
  assert(src.includes('function resolveListingImage'));
  assert(src.includes('isLegacySeedOperatorUrl(key, current)'));
  assert(src.includes('img: resolveListingImage(listing, company)'));
});
check('no Edit select lock renderer remains', () => {
  const ui = read('public/js/dashboard-workspace.js');
  assert(!ui.includes('if (field.locked)'));
  assert(!ui.includes('data-locked-selection'));
  assert(!ui.includes('locked:true'));
  assert(!ui.includes('locked:editing'));
});
check('Route Edit Bus listing is freely selectable', () => {
  const ui = read('public/js/dashboard-workspace.js');
  const i = ui.indexOf("mode === 'edit' && key === 'route'");
  const part = ui.slice(i, i + 7000);
  assert(part.includes("name:'listingId', label:'Bus listing', type:'select'"));
  assert(!part.includes("name:'listingId', label:'Bus listing', type:'select', icon:'fa-layer-group', options:listings, required:true, locked"));
});
check('Vehicle and Fare Edit relationships are freely selectable', () => {
  const ui = read('public/js/dashboard-workspace.js');
  assert(!/name:'listingId'[^\n]*locked/.test(ui));
  assert(!/name:'routeId'[^\n]*locked/.test(ui));
});
check('Stay relationship Edit selects are freely selectable', () => {
  const ui = read('public/js/dashboard-workspace.js');
  for (const name of ['propertyId','roomTypeId','roomUnitId','ratePlanId']) assert(!new RegExp(`name:'${name}'[^\\n]*locked`).test(ui));
});
check('seat template uses selected Vehicle rather than row-locked path', () => {
  const ui = read('public/js/dashboard-workspace.js');
  assert(ui.includes("action: '/company/vehicles/seat-template'"));
});
check('bus backend persists validated relationship reassignment', () => {
  const src = read('src/modules/bus/services/busSetupService.js');
  assert(src.includes('routeSegments.updateMany'));
  assert(src.includes('seatMapTemplates.updateMany'));
  assert(src.includes('Fare plan moved to another route; re-price the new route stops.'));
});
check('hotel backend persists validated relationship reassignment', () => {
  const src = read('src/services/hotel/hotelService.js');
  for (const code of ['hotel_property_listing_change_committed','hotel_room_type_parent_change_committed','hotel_room_unit_parent_change_committed','hotel_rate_plan_parent_change_committed','hotel_inventory_relationship_committed']) assert(src.includes(code), code);
});
check('all bundled seeded images still exist', () => {
  for (const rel of [...Object.values(seedMedia.SEEDED_BLOG_IMAGE_FILES), ...Object.values(seedMedia.SEEDED_OPERATOR_IMAGE_FILES)]) {
    const f = path.join(root, 'public', rel.replace(/^\//,''));
    assert(fs.existsSync(f) && fs.statSync(f).size > 1000, rel);
  }
});
check('service worker uses v1.6.52 and does not precache media routes', () => {
  const sw = read('public/sw.js');
  assert(/classic-trip-static-v1\.6\.(?:5[2-9]|[6-9]\d+)/.test(sw));
  assert(!sw.includes("'/media/blog/"));
  assert(!sw.includes("'/media/operator/"));
});
check('source and public assets have no stale v1.6.51 version', () => {
  for (const base of ['src','public']) {
    const stack=[path.join(root,base)];
    while(stack.length){ const cur=stack.pop(); for(const ent of fs.readdirSync(cur,{withFileTypes:true})){ const f=path.join(cur,ent.name); if(ent.isDirectory()) stack.push(f); else if(/\.(?:js|ejs|css)$/.test(ent.name)) assert(!fs.readFileSync(f,'utf8').includes('1.6.51'), f); } }
  }
});
console.log(`\n${passed}/18 v1.6.52 media + selectable edit repair checks passed.`);

#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
let passed = 0;
function check(label, fn) {
  try { fn(); passed += 1; console.log(`✓ ${label}`); }
  catch (error) { console.error(`✗ ${label}: ${error.message}`); process.exitCode = 1; }
}
const seed = read('scripts/seed-launch-stays.js');
const home = read('src/views/pages/home.ejs');
const hotelService = read('src/services/hotel/hotelService.js');
const listingCard = read('src/views/partials/listing-card.ejs');
const pkg = JSON.parse(read('package.json'));

check('release is v1.6.86', () => assert.strictEqual(pkg.version, '1.6.86'));
for (const name of ['Dandy Hotel Juba','Zoom Future Hotel','Vision Gate Hotel','Kal Hotel & Garden','Pyramid Continental Hotel','Radisson Blu Hotel, Juba']) {
  check(`stay seed includes ${name}`, () => assert(seed.includes(`name: '${name}'`)));
}
check('stay seed creates hotel partner companies and property listings', () => {
  assert(seed.includes("companyType: 'hotel'")); assert(seed.includes("partnerCategory: 'hotel_partner'")); assert(seed.includes("serviceType: 'hotel'")); assert(seed.includes('HotelProperty'));
});
check('seeded stay profiles are public but never bookable without inventory', () => {
  assert(seed.includes("releaseStatus: 'published'")); assert(seed.includes("status: 'active'")); assert(seed.includes('bookable: false')); assert(seed.includes('publicProfileOnly: true'));
  assert(seed.includes('priceFrom: 0')); assert(!seed.includes('RoomNight.create')); assert(!seed.includes('RoomUnit.create')); assert(!seed.includes('RatePlan.create'));
});
check('stay profile reconciliation does not hide non-bookable onboarding profiles', () => {
  assert(hotelService.includes('listing.serviceDetails?.publicProfileOnly === true'));
  assert(hotelService.includes("listing.releaseStatus = 'published'"));
});
check('normal hotel publish clears profile-only mode and still uses readiness gate', () => {
  assert(hotelService.includes('const readiness = await hotelListingReadiness(companyId, listingId)'));
  assert(hotelService.includes('publicProfileOnly: false'));
  assert(hotelService.includes('bookable: true'));
});
check('non-bookable stay profiles invite viewing instead of claiming no inventory', () => {
  assert(listingCard.includes("isHotelListing && !listing.bookable ? 'View service'"));
  assert(listingCard.includes("isHotelListing && !listing.bookable ? 'fa-eye'"));
  assert(home.includes('Booking opens only when verified dated inventory is available.'));
});
check('zero-data marketplace sections are omitted from Home', () => {
  for (const variable of ['busListings','hotelListings','flightListings','taxiListings','tourListings','rentalListings','cargoListings']) assert(home.includes(`if (${variable}.length) {`), variable);
  assert(home.includes('if (sponsored.length) {'));
  assert(home.includes('if (bootstrap.blogs && bootstrap.blogs.length) {'));
  assert(!home.includes('data-home-empty='));
});
check('stay seed records research sources and partner confirmation requirements', () => {
  assert(seed.includes('researchSources: stay.sources')); assert(seed.includes('requiresPartnerConfirmation: true')); assert(seed.includes('partnerContactReportedByPlatformOwner: true'));
});
check('stay seed creates separate one-time partner credentials file', () => {
  assert(seed.includes("stay-partner-credentials.json")); assert(seed.includes('passwordChangeRequired: true')); assert(seed.includes('bcrypt.hash'));
});
check('seeded Stay profiles use verified real-media sources and safe fallbacks', () => {
  assert(seed.includes("image: '/images/stays/dandy-hotel-real.jpg'"));
  assert(seed.includes('imgservice.cabinns.com/680x408/dandy-hotel-juba'));
  const dandyBlock = seed.slice(seed.indexOf("key: 'dandy-hotel'"), seed.indexOf("key: 'zoom-future-hotel'"));
  assert(!dandyBlock.includes('imageSource:'), 'Dandy must use its bundled real image rather than a hot-linked runtime source');
  assert(seed.includes('facebook.com/61554424816873/photos/122111528192147493'));
  assert(seed.includes('facebook.com/visiongatehotel/photos/our-accommodation-are-unrivalled'));
  assert(seed.includes('facebook.com/100071841384072/posts/welcome-to-kal-hotel-and-garden'));
  assert(seed.includes("image: '/images/stays/pyramid-continental-hotel.jpg'"));
  assert(seed.includes('media.radissonhotels.net/image/radisson-blu-hotel-juba/exterior'));
  assert(seed.includes('resolveRealStayMedia'));
  assert(seed.includes('extractSocialImage'));
  assert(seed.includes('uploadBuffer(downloaded.buffer'));
});
if (!process.exitCode) 
check('all seeded Stay profiles have a renderable image or local fallback', () => {
  assert(seed.includes("/images/stays/dandy-hotel-real.jpg"));
  assert(seed.includes("/images/stays/zoom-future-hotel.svg"));
  assert(seed.includes("/images/stays/vision-gate-hotel.svg"));
  assert(seed.includes("/images/stays/kal-hotel.svg"));
  assert(fs.existsSync(path.join(root, 'public/images/stays/stay-fallback.svg')));
  const dandyImage = fs.readFileSync(path.join(root, 'public/images/stays/dandy-hotel-real.jpg'));
  assert(dandyImage.length > 10000, 'Dandy real image should not be a tiny placeholder');
  assert(dandyImage[0] === 0xff && dandyImage[1] === 0xd8 && dandyImage[2] === 0xff, 'Dandy real image must be JPEG');
});

check('remote Stay media resolver is bounded, allow-listed and Cloudinary-persistent', () => {
  assert(seed.includes('REAL_MEDIA_MAX_HTML'));
  assert(seed.includes('REAL_MEDIA_MAX_IMAGE'));
  assert(seed.includes("host.endsWith('.fbcdn.net')"));
  assert(seed.includes('setTimeout(() => controller.abort(), 12000)'));
  assert(seed.includes('detectedMimeType(buffer)'));
  assert(seed.includes("uploadBuffer(downloaded.buffer, 'classic-trip/hotels/launch-stays'"));
  assert(seed.includes('seedOwnedMedia(currentMedia)'));
});

check('Kal Hotel & Garden is included without invented room inventory', () => {
  assert(seed.includes("key: 'kal-hotel'"));
  assert(seed.includes("+211921661912"));
});
check('Dandy Hotel Juba replaces the mistaken Daddy seed with researched details', () => {
  assert(seed.includes("key: 'dandy-hotel'"));
  assert(seed.includes("legacyKeys: ['daddy-hotel']"));
  assert(seed.includes("legacyNames: ['Daddy Hotel']"));
  assert(seed.includes("name: 'Dandy Hotel Juba'"));
  assert(seed.includes('Shirikat off Nimule Road / Juba–Nimule Highway'));
  assert(seed.includes('+211926608007'));
  assert(seed.includes('+211917996219'));
  assert(seed.includes('info@dandyhotel.net'));
  assert(seed.includes('45-room property'));
  assert(seed.includes("'24-hour front desk'"));
  assert(seed.includes("checkInTime: '12:00'"));
  assert(seed.includes("checkOutTime: '10:00'"));
});
check('Dandy migration reuses and renames the legacy Daddy seeded records instead of duplicating them', () => {
  assert(seed.includes('stayCompanyLookup(stay)'));
  assert(seed.includes('isLegacySeedIdentity(stay, company)'));
  assert(seed.includes('isLegacySeedIdentity(stay, listing)'));
  assert(seed.includes('isLegacySeedIdentity(stay, property)'));
  assert(seed.includes('company.slug = stay.key'));
  assert(seed.includes('listing.slug = `${stay.key}-stay`'));
  assert(seed.includes('property.propertyName = stay.name'));
  assert(seed.includes('user.fullName = `${stay.name} Partner Admin`'));
});
console.log(`\n${passed}/${passed} launch stay checks passed.`);

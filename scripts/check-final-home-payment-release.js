#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const draft = read('src/modules/bus/services/busBookingDraftService.js');
const listing = read('src/views/pages/listing-details.ejs');
const errors = read('src/middlewares/errorHandler.js');
const home = read('src/views/pages/home.ejs');
const homeJs = read('public/js/home.js');
const css = read('public/css/completion-fixes.css');
const pkg = JSON.parse(read('package.json'));
const controller = read('src/controllers/public/listingController.js');
const inventory = read('src/modules/bus/services/busInventoryService.js');
const repository = read('src/modules/bus/repositories/busRepository.js');
const listingCard = read('src/views/partials/listing-card.ejs');

let passed = 0;
function check(label, condition) {
  if (!condition) throw new Error(label);
  passed += 1;
}

check('release version is 1.6.1', pkg.version === '1.6.1');
check('checkout preparation avoids duplicate full availability loading', controller.includes('const context = await publicListingContext(req.params.slug, req.params.serviceType)') && controller.includes('holdSeats performs'));
check('booking page reuses the prefetched marketplace snapshot', controller.includes('publicContext)') && controller.includes('includeReturnSchedules: false'));
check('seat-hold item identifiers are allocated in one database call', repository.includes('nextIds') && inventory.includes("repository.nextIds('hold-item', inventoryRows.length)"));
check('compatibility seats are recalculated in one batched read/write path', inventory.includes('async function recalculateCompatibilitySeats') && inventory.includes('repository.seats.saveMany(seats'));
check('checkout skips global stale-hold sweeps and releases only selected expired holds', !inventory.slice(inventory.indexOf('async function holdSeats'), inventory.indexOf('async function assertActiveHold')).includes('expireStaleHolds()') && inventory.includes('staleSelectedHoldIds'));
check('desktop bars use wider images, one-line descriptions, and content-driven height', css.includes('grid-template-columns:148px minmax(0,1fr)') && css.includes('align-self:start;min-height:0;height:auto') && css.includes('min-height:0;max-height:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'));
check('availability badge is outside the thumbnail and anchored to the bar corner', listingCard.indexOf('</a>') < listingCard.indexOf('cornerBadge') && css.includes('[data-view="bars"] .cornerBadge{position:absolute;top:10px;right:10px'));
check('decorative section color overrides were removed', !css.includes('marketplaceSection--bus::before') && !css.includes('marketplaceSection--hotel .sectionViewToggle button.active{color:'));
check('checkout prepares reusable drafts before taking another hold', draft.indexOf('await reusableDraft') < draft.indexOf('await validateLeg(outboundInput'));
check('reusable drafts compare schedules, stops and selected seats', draft.includes('draftMatchesInput') && draft.includes('sameValues(outbound.selectedSeats'));
check('reused draft returns the original checkout URL', draft.includes('reused: true') && draft.includes('redirectUrl: `/book/bus/'));
check('payment button is locked while checkout is prepared', listing.includes('checkoutPreparePending') && listing.includes('setPaymentButtonBusy(true)'));
check('checkout preparation always unlocks in finally', listing.includes('finally {') && listing.includes('setPaymentButtonBusy(false)'));
check('real seat conflicts refresh live availability', listing.includes('refreshAfterCheckoutConflict') && listing.includes("'seat_unavailable'"));
check('JSON errors include machine-readable conflict codes', errors.includes("code: error.code || 'request_failed'"));
check('phone hero statistics are hidden', css.includes('.homePage .heroCard>.stats,.homePage .hero .stats{display:none!important}'));
check('featured buses start with four records', home.includes('var initialBusListings = busListings.slice(0, 4)'));
check('featured buses use two mobile rows', css.includes('grid-template-rows:repeat(2,minmax(0,auto))!important'));
check('featured buses expose about one-quarter of the next mobile column', css.includes('grid-auto-columns:75vw!important') && css.includes('padding:2px 18vw 8px 0'));
check('all desktop card sections keep three fixed columns', css.includes('.sectionListingCollection[data-view="cards"]{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important'));
check('bar view is two columns on desktop', css.includes('.sectionListingCollection[data-view="bars"]{display:grid!important;grid-template-columns:repeat(2'));
check('bar view is one column on phones', css.includes('.sectionListingCollection[data-view="bars"]{grid-template-columns:1fr!important'));
check('section view preference is persisted', homeJs.includes('classicTripSectionView:') && homeJs.includes('setSectionView'));
check('more controls only remain visible when data remains', homeJs.includes("button.classList.toggle('hide', remaining <= 0)") && homeJs.includes('button.disabled = remaining <= 0'));
for (const group of ['bus', 'hotel', 'flight', 'local_transport', 'tour', 'car_rental', 'cargo']) {
  check(`${group} has its own view toggle`, home.includes(`data-group="${group}" data-view="cards"`) && home.includes(`data-group="${group}" data-view="bars"`));
}
for (const variant of ['bus', 'hotel', 'flight', 'taxi', 'tour', 'rental', 'cargo']) {
  check(`${variant} section has a unique design class`, home.includes(`marketplaceSection--${variant}`) && css.includes(`marketplaceSection--${variant}`));
}

console.log(`Final payment and homepage release checks passed (${passed}/${passed}).`);

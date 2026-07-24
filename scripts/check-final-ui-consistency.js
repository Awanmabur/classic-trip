'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
}

const hotel = read('src/views/dashboards/shared/sections/hotel-rooms.ejs');
const workspace = read('src/views/dashboards/shared/workspace.ejs');
const dashboardCss = read('public/css/dashboard-workspace.css');
const dashboardJs = read('public/js/dashboard-workspace.js');
const home = read('src/views/pages/home.ejs');
const homeJs = read('public/js/home.js');
const card = read('src/views/partials/listing-card.ejs');
const search = read('src/views/pages/search.ejs');
const services = read('src/views/pages/services.ejs');
const companies = read('src/views/pages/company-profile.ejs');
const promoters = read('src/views/pages/promoters.ejs');

assert(hotel.includes('Hotel setup journey') && hotel.includes('hotelSetupStep'), 'Hotel setup must be presented as one ordered journey');
assert(hotel.includes('Public hotel listing') && hotel.includes('Property profile') && hotel.includes('Dated inventory'), 'Hotel setup journey must cover listing through dated inventory');
assert(hotel.includes("data-type=\"hotel property\"") && hotel.includes("data-type=\"room type\"") && hotel.includes("data-type=\"rate plan\"") && hotel.includes("data-type=\"room units\"") && hotel.includes("data-type=\"room night inventory\""), 'Each hotel setup stage must keep its canonical action');
assert(hotel.includes('Today’s hotel operations') && hotel.includes('Arrivals today') && hotel.includes('In-house stays') && hotel.includes('Departures today') && hotel.includes('Maintenance'), 'Hotel setup and daily operations must be separated');
assert(hotel.includes('hotelPaneHeader') && hotel.includes('Properties <em>') && hotel.includes('Housekeeping <em>'), 'Hotel tabs must have contextual headings and record counts');
assert(hotel.includes('hotelOpsLayoutSingle'), 'Hotel tables and room map must use a full-width layout');
assert(workspace.includes('dashboardHomeLink') && workspace.includes('href="/"') && workspace.includes('Back to marketplace'), 'Dashboard brand must link to the public home page');
assert(dashboardCss.includes('.dashboardHomeLink') && dashboardCss.includes('.hotelSetupJourney') && dashboardCss.includes('.hotelPaneHeader'), 'Dashboard styles must support the reorganized hotel flow');
assert(dashboardJs.includes('emptyTableRow') && dashboardJs.includes('emptyTableState'), 'Empty table records must use a dedicated rounded state');
assert(dashboardCss.includes('.emptyTableRow td') && dashboardCss.includes('border-radius:18px!important'), 'Empty table background must have complete rounded edges');
assert(dashboardCss.includes('.card>.notice:not(.hotelEmptyNotice)') && dashboardCss.includes('margin:12px 16px 16px'), 'Dashboard warnings must have consistent container spacing');
assert(home.includes("include('../partials/listing-card'") && search.includes("include('../partials/listing-card'") && services.includes("include('../partials/listing-card'") && companies.includes("include('../partials/listing-card'") && promoters.includes("include('../partials/listing-card'"), 'All marketplace listing pages must use one shared card partial');
assert(card.includes('marketplaceListingCard') && card.includes('Starting fare · choose boarding and drop-off') && card.includes('per available room night'), 'Shared card must support bus and hotel pricing copy');
assert(homeJs.includes('marketplaceListingCard') && homeJs.includes('per available room night'), 'Dynamically rendered home cards must match the shared card');
assert(!home.includes('referenceBusCard" data-id') && !home.includes('<article class="listing referenceBusCard"'), 'Homepage must not keep a second hard-coded card implementation');
assert((home.match(/Become a partner/g) || []).length <= 3, 'Homepage must not duplicate the same partner footer link');

console.log(`Final UI consistency checks passed (${passed}/${passed}).`);

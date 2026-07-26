'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const failures = [];
let checks = 0;
function check(condition, message) { checks += 1; if (!condition) failures.push(message); }

const travelCss = read('public/css/pages/travel-booking.css');
const homeCss = read('public/css/pages/home.css');
const auth = read('src/views/pages/auth/login.ejs');
const signup = read('src/views/pages/auth/_partner-signup.ejs');
const companies = read('src/views/pages/companies.ejs');
const partnerCommission = read('src/views/pages/partner-commission.ejs');
const dashboard = read('public/js/dashboard-workspace.js');
const workspace = read('src/views/dashboards/shared/workspace.ejs');
const seo = read('src/services/seo/seoService.js');
const head = read('src/views/partials/site-head.ejs');
const registry = require('../src/config/serviceRegistry');
const markets = require('../src/config/countryMarkets');

check(/extend the approved Classic Trip public UI/.test(travelCss), 'Flight and mobility pages must extend the approved UI without replacing it');
check(/\.travelControl\{[^}]*min-height:38px[^}]*border-radius:999px/.test(travelCss), 'Travel controls must match the compact rounded reference controls');
check(/\.travelPage \.heroTitle[^}]*display:block!important/.test(travelCss) && /\.partnersDirectoryPage \.heroTitle/.test(read('public/css/four-service-ui.css')), 'New service and marketing pages must restore their titles inside the reference phone layout');
check(/\.priceRow\{display:flex/.test(homeCss) && /class="actions"/.test(read('src/views/partials/listing-card.ejs')), 'Marketplace price and action layout must preserve the approved responsive reference card');
check(/View<\/a>/.test(read('src/views/partials/listing-card.ejs')) && /Book<\/a>/.test(read('src/views/partials/listing-card.ejs')), 'View and Book actions must remain together in the shared card');
check(/\.partnerFormCard\{padding:18px;display:grid;gap:14px/.test(auth) && /\.partnerFormCard \.row2\{gap:12px/.test(auth), 'Authentication and intelligent onboarding must retain the approved scoped spacing');
check(/countryMarkets\.forEach/.test(signup) && /data-currency/.test(signup), 'Partner signup must derive currency from country');
check(/partnerDirectoryCard/.test(companies) && /Join as a partner/.test(companies) && /Explore services/.test(companies), 'Partner marketing directory must be styled and persuasive');
check(/include\('\.\.\/partials\/site-head'/.test(partnerCommission) && /metricRow/.test(partnerCommission) && /detailGrid/.test(partnerCommission), 'Partner commission page must load the shared public styles and responsive layout');
check(/countryMarkets: countryMarkets/.test(workspace), 'Dashboard must receive the shared country market configuration');
check(/bindCountryCurrency/.test(dashboard) && /currencyForCountryBrowser/.test(dashboard), 'Dashboard must synchronize country, currency and timezone');
check(markets.currencyForCountry('Uganda') === 'UGX', 'Uganda must map to UGX');
check(markets.currencyForCountry('Kenya') === 'KES', 'Kenya must map to KES');
check(markets.currencyForCountry('South Sudan') === 'SSP', 'South Sudan must map to SSP');
check(JSON.stringify(registry.ACTIVE_SERVICE_TYPES) === JSON.stringify(['bus','hotel','flight','local_transport']), 'Only the four completed service types may be active');
check(JSON.stringify(registry.COMING_SOON_SERVICE_TYPES) === JSON.stringify(['tour','car_rental','cargo']), 'Only the approved roadmap categories may remain');
check(/PerplexityBot/.test(seo) && /Claude-SearchBot/.test(seo) && /llmsFullTxt/.test(seo), 'AI-search discovery files and crawler policy must be present');
check(/TravelAgency/.test(head) && /SearchAction/.test(head) && /llms-full\.txt/.test(head), 'Structured data and AI-readable alternate links must be present');

if (failures.length) {
  console.error(`Final platform polish validation failed (${failures.length}/${checks}):`);
  failures.forEach((failure, index) => console.error(`${index + 1}. ${failure}`));
  process.exit(1);
}
console.log(`Final platform polish validation passed (${checks}/${checks}).`);

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

check(/Final compact travel polish/.test(travelCss), 'Flight and mobility pages must use final compact shared controls');
check(/min-height:42px/.test(travelCss) && /border-radius:999px/.test(travelCss), 'Travel controls must be compact and rounded');
check(!/\.heroTitle,\.heroSub,[^{]+\{display:none!important\}/.test(homeCss), 'Global mobile CSS must not hide headings outside the homepage');
check(/marketplaceListingCard \.priceRow\{display:grid/.test(homeCss), 'Marketplace price and action layout must be responsive');
check(/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(homeCss), 'View and Book actions must stay in one row');
check(/Final auth\/onboarding polish/.test(auth), 'Authentication and onboarding must use the final shared spacing');
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

'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const render = read('render.yaml');
const envExample = read('.env.example');
const materializer = read('src/jobs/materializeSchedules.js');
const catalog = read('src/services/marketplace/catalogService.js');
const home = read('src/views/pages/home.ejs');
const heroSearch = read('src/views/partials/home/hero-search.ejs');
const routes = read('src/views/pages/routes.ejs');
const flights = read('src/views/pages/flights.ejs');
const flightJs = read('public/js/flights.js');
const legal = [read('src/views/pages/privacy.ejs'), read('src/views/pages/terms.ejs'), read('src/views/pages/support.ejs'), read('src/config/env.js')].join('\n');
let passed = 0;
function check(label, ok) {
  if (!ok) { console.error(`✗ ${label}`); process.exitCode = 1; }
  else { passed += 1; console.log(`✓ ${label}`); }
}
check('release includes v1.6.38 work', pkg.version === '1.6.45');
check('Render uses the real HTTPS domain', render.includes('value: https://www.classictrip.org') && !render.includes('value: http://www.classictrip.org'));
check('public/fallback Classic Trip domain uses .org', !legal.includes('classictrip.com') && legal.includes('classictrip.org'));
check('IndexNow key is wired in production', /key: INDEXNOW_KEY\s+value: [A-Za-z0-9-]{8,128}/m.test(render) && /INDEXNOW_KEY=[A-Za-z0-9-]{8,128}/.test(envExample));
check('departed date advances rolling far edge immediately', materializer.includes('function rollingWindowBounds') && materializer.includes('effectiveHorizonEnd = new Date(effectiveHorizonEnd.getTime() + DAY_MS)') && materializer.includes('replacedDepartedDate = true'));
check('vehicle conflict blocker auto-retries after cooldown', materializer.includes('VEHICLE_CONFLICT_BLOCKER_COOLDOWN_MS = 15 * 60 * 1000') && materializer.includes('until <= now) return null'));
check('home builds search options from public DB snapshot', catalog.includes('function searchOptions(') && catalog.includes('searchOptions: searchOptions(data, listings, airports)') && catalog.includes('flightSearchService.listAirports()'));
check('home bus From/To are selects', home.includes('<select id="busFromInput"') && home.includes('<select id="busToInput"') && !home.includes('<input id="busFromInput"'));
check('home service locations are DB selects', ['stayCityInput','flightFromInput','flightToInput','taxiPickupInput','taxiDestinationInput','tourCityInput','rentalPickupInput','rentalReturnLocationInput','cargoPickupInput','cargoDeliveryInput'].every((id) => home.includes(`<select id="${id}"`)));
check('general marketplace From/To are selects', heroSearch.includes('<select id="marketplaceOrigin"') && heroSearch.includes('<select id="marketplaceDestination"'));
check('route directory From/To are selects', routes.includes('<select id="routeSearchOrigin"') && routes.includes('<select id="routeSearchDestination"'));
check('flight page uses database-backed airport selects', flights.includes('<select id="flightOrigin"') && flights.includes('<select id="flightDestination"') && flightJs.includes("api('/api/v1/flights/airports')"));
if (!process.exitCode) console.log(`v1.6.38 domain/rolling/DB-search checks passed (${passed}/${passed}).`);

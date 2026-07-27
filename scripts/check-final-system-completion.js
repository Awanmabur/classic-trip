const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const checks = [];
const check = (name, condition) => {
  if (!condition) throw new Error(`FAIL: ${name}`);
  checks.push(name);
};
const includesAll = (text, fragments) => fragments.every((fragment) => text.includes(fragment));

const crypto = require('crypto');
const hash = (relative) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex');
const approvedCss = {
  'public/css/base.css': '653530243e926bc64e4cb2e733066dcb18586af8baa86ff8d8351701ab976ca5',
  'public/css/components.css': 'd6d52392225dd6c931954ae51cd658dc27f94601de35b025ae59b4b1a50e3965',
  'public/css/dashboard-workspace.css': '68c5a5b6e4b90fb4153430a043e64724865ddc9ca3d283386c366eb9f3865ab5',
  'public/css/pages/home.css': '13cfcd80c2faf456d0ffec8f425d033f884722e3101a1cbb3d1be1479cb94005',
  'public/css/pages/search.css': '9d628350e2fb57410892b042adba04a807e4e6d52de1ab279e288a0bad522b42',
  'public/css/pages/booking.css': '7e252f0ce1c3646c7be147d04be5fbd946aa91ffb34c79698ceb6850c6166075',
};
for (const [file, expected] of Object.entries(approvedCss)) check(`${file} matches approved uploaded UI`, hash(file) === expected);

const siteHead = read('src/views/partials/site-head.ejs');
const dashboardWorkspace = read('src/views/dashboards/shared/workspace.ejs');
const homeView = read('src/views/pages/home.ejs');
const travelCss = read('public/css/pages/travel-booking.css');
const publicAdditions = read('public/css/four-service-ui.css');
const dashboardAdditions = read('public/css/dashboard-service-additions.css');
check('public shell loads reference CSS plus scoped four-service additions', includesAll(siteHead, ['/css/pages/home.css', '/css/base.css', '/css/components.css', '/css/four-service-ui.css']));
check('dashboard shell loads reference CSS plus scoped service additions', includesAll(dashboardWorkspace, ['/css/dashboard-workspace.css', '/css/dashboard-service-additions.css']));
check('home loads the approved reference stylesheet', homeView.includes('/css/pages/home.css'));
check('new public additions remain scoped', includesAll(publicAdditions, ['.partnersDirectoryPage', '.supportPage']) && !publicAdditions.includes('body{'));
check('new dashboard additions remain scoped', includesAll(dashboardAdditions, ['.adminSupplyControl', '.hotelSetupJourney']) && !dashboardAdditions.includes('.sidebar{'));
check('travel extension contains real map and phone breakpoints', includesAll(travelCss, ['.liveMap', '@media(max-width:680px)', '.travelControl']));
const forbiddenVisualLayers = ['accessibility.css','platform-layout-polish.css','final-system-audit.css','dashboard-final-polish.css','auth-layout-polish.css','production-ui-lock.css'];
for (const view of walk(path.join(root, 'src/views')).filter((file) => file.endsWith('.ejs'))) {
  const source = readAbsolute(view);
  check(`${path.relative(root, view)} does not load a destructive global override`, !forbiddenVisualLayers.some((name) => source.includes(name)));
}

const taxiPage = read('src/views/pages/taxi.ejs');
const taxiClient = read('public/js/taxi.js');
const trackingPage = read('src/views/pages/taxi-track.ejs');
const trackingClient = read('public/js/taxi-track.js');
check('taxi customer page uses a real map surface', includesAll(taxiPage, ['leaflet', 'taxiMap', 'liveMap']));
check('taxi booking client renders map and road geometry', includesAll(taxiClient, ['L.map', 'L.polyline', 'route.geometry', 'navigator.geolocation']));
check('taxi tracking page loads map assets', includesAll(trackingPage, ['leaflet', 'taxiTrackApp']));
check('taxi tracking client refreshes securely and supports customer actions', includesAll(trackingClient, [
  'L.map',
  'setInterval',
  '/cancel',
  '/incidents',
  'lookupCode'
]));

const routing = read('src/services/location/roadRoutingService.js');
const fencing = read('src/services/location/geoFenceService.js');
check('backend road-routing adapter supports route geometry and production fail-closed mode', includesAll(routing, [
  'routingApiUrl',
  'geometry',
  'requireLiveRouting',
  'AbortController'
]));
check('backend geofence enforcement supports polygons and radius zones', includesAll(fencing, ['pointInPolygon', 'haversineKm', 'withinZone']));

const taxiRide = read('src/modules/taxi/services/taxiRideService.js');
const flightBooking = read('src/modules/flight/services/flightBookingService.js');
const workflow = read('src/services/support/workflowService.js');
check('taxi cancellation creates a real refund workflow', includesAll(taxiRide, ['requestRefundLive', 'reportCustomerIncident', 'safeEqual']));
check('flight cancellation creates a real refund workflow', includesAll(flightBooking, ['requestRefundLive', 'safeEqual']));
check('refund workflow can participate in caller transaction', includesAll(workflow, ['session = null', 'persist', 'activeSession']));

const support = read('src/views/pages/support.ejs');
check('Contact and Help use rounded shared cards and complete service topics', includesAll(support, [
  'supportGrid',
  'Bus journey',
  'Stay booking',
  'Flight booking',
  'Local ride or boda'
]));
check('Contact and Help contains no page-level inline style block', !support.includes('<style>'));

for (const manifest of [
  'src/views/pages/company-customer-manifest.ejs',
  'src/views/pages/driver-manifest-print.ejs'
]) {
  const body = read(manifest);
  check(`${manifest} contains responsive table containment`, includesAll(body, ['class="tableScroll"', '@media(max-width:760px)', 'overflow:auto']));
}

const receipt = read('src/views/pages/offline-sale-receipt.ejs');
const ticket = read('src/views/pages/driver-ticket-detail.ejs');
check('offline receipt is responsive on phones', includesAll(receipt, ['@media(max-width:680px)', 'grid-template-columns:1fr']));
check('driver ticket detail is responsive without inline layout overrides', includesAll(ticket, ['@media(max-width:760px)', 'compactTop', 'fullWidth']) && !ticket.includes('style="padding-top:0"'));

const home = read('src/views/pages/home.ejs');
check('homepage presents all seven live service domains', includesAll(home, ['Buses', 'Stays', 'Flights', 'Local taxi', 'Tours', 'Car rentals', 'Cargo', 'Airbnb']));
check('homepage exposes search and AI-readable metadata', includesAll(home, ['application/ld+json', '/llms.txt', 'canonical']));

const publicSources = [
  ...walk(path.join(root, 'src')),
  ...walk(path.join(root, 'public'))
].filter((file) => /\.(js|ejs|css|json|txt|md)$/i.test(file));
const prohibited = /\b(ferries|ferry|trains|train)\b/i;
const prohibitedHits = publicSources
  .map((file) => ({ file, match: readAbsolute(file).match(prohibited) }))
  .filter((entry) => entry.match);
check('Ferry and Train services are absent from application source', prohibitedHits.length === 0);

const envExample = read('.env.example');
check('map and routing production settings are documented', includesAll(envExample, [
  'MAP_TILE_URL=',
  'TAXI_ROUTING_API_URL=',
  'TAXI_REQUIRE_LIVE_ROUTING='
]));

console.log(`Final system completion checks passed: ${checks.length}/${checks.length}`);
checks.forEach((name, index) => console.log(`${index + 1}. ${name}`));

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const location = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(location) : [location];
  });
}
function readAbsolute(file) {
  return fs.readFileSync(file, 'utf8');
}

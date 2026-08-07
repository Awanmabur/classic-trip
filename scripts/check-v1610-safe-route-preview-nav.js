'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
let passed = 0;
function check(label, condition) {
  if (!condition) throw new Error(label);
  passed += 1;
  console.log(`✓ ${label}`);
}

const pkg = JSON.parse(read('package.json'));
const companyRepository = read('src/repositories/domain/companyOperationsRepository.js');
const companyService = read('src/services/company/companyService.js');
const catalog = read('src/services/marketplace/catalogService.js');
const controller = read('src/controllers/public/listingController.js');
const card = read('src/views/partials/listing-card.ejs');
const details = read('src/views/pages/listing-details.ejs');
const homeJs = read('public/js/home.js');
const css = read('public/css/completion-fixes.css');
const dashboard = read('src/services/dashboard/dashboardProjectionEngine.js');

check('release is based on the safe 1.6.7 baseline and remains valid in the current release', Number(String(pkg.version).split('.')[2] || 0) >= 16);
check('rolling route guard has a real routes repository', companyRepository.includes("routes: new MongoCollection('routes')"));
check('route-stop guards also have a real repository', companyRepository.includes("routeStops: new MongoCollection('routeStops')"));
check('bus route validation reads the defined routes repository', companyService.includes('companyRepository.routes.findOne'));
check('catalog creates every active route summary', catalog.includes('const routeSummaries = serviceType === \'bus\' ? activeRoutes.map'));
check('catalog exposes route summaries on each bus item', catalog.includes('routes: routeSummaries') && catalog.includes('routeCount: routeSummaries.length'));
check('catalog search includes all route labels', catalog.includes('...routeSummaries.map((item) => item.label)'));
check('server-rendered cards show all company routes', card.includes('companyRouteList') && card.includes('companyRoutes.forEach'));
check('client-rendered cards show all company routes', homeJs.includes('companyRoutesHtml') && homeJs.includes('item.routes.map'));
check('preview exposes a route selector', details.includes('id="outboundRouteSelect"'));
check('route selector is before travel time', details.indexOf('id="outboundRouteSelect"') < details.indexOf('id="outboundScheduleSelect"'));
check('boarding follows travel time', details.indexOf('id="outboundScheduleSelect"') < details.indexOf('id="outboundOriginStopSelect"'));
check('drop-off follows boarding', details.indexOf('id="outboundOriginStopSelect"') < details.indexOf('id="outboundDestinationStopSelect"'));
check('route choice filters available departures', details.includes('schedulesForActiveRoute') && details.includes('schedule.routeId'));
check('route changes clear stale fare and seat selection', details.includes('previewPricing.scheduleId = \'\'') && details.includes('activeReturnSelections = []'));
check('return choices must be strictly later than outbound', details.includes('returnTime > outboundFloor'));
check('controller preserves selected route state', controller.includes('const selectedRouteId = String(selection.routeId') && controller.includes('selectedRouteId,'));
check('journey controls use a two-column layout', css.includes('.listingPreviewPage .busJourneySelectionGrid') && css.includes('grid-template-columns:repeat(2,minmax(0,1fr))'));
check('homepage header uses the real header.nav selector', css.includes('body.homePage > header.nav'));
check('bottom navigation is centered and full shell width', css.includes('transform:translateX(-50%)') && css.includes('width:var(--ct-public-shell-width)'));
check('bottom navigation uses five stable columns', css.includes('grid-template-columns:repeat(5,minmax(0,1fr))'));
check('route chips remain horizontally scrollable', css.includes('.companyRouteList') && css.includes('overflow-x:auto'));
check('dashboard price-from falls back to fare products and segments', dashboard.includes('listingFareFromIndex') && dashboard.includes('state.busSegmentFares'));

console.log(`v1.6.10+ safe route/preview/navigation checks passed (${passed}/${passed}).`);

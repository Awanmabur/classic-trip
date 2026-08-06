'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
let passed = 0;
function check(name, ok) {
  if (!ok) { console.error(`✗ ${name}`); process.exitCode = 1; }
  else { passed += 1; console.log(`✓ ${name}`); }
}
const css = read('public/css/completion-fixes.css');
const seatMap = read('src/views/dashboards/shared/sections/seat-maps.ejs');
const details = read('src/views/pages/listing-details.ejs');
const materializer = read('src/jobs/materializeSchedules.js');
const model = read('src/models/ScheduleRule.js');
const route = read('src/utils/routeLabel.js');
const worker = read('src/worker.js');
const app = read('src/app.js');
const dashboard = read('src/services/dashboard/dashboardProjectionEngine.js');
const bookingForm = read('src/views/pages/booking-form.ejs');
const listingCard = read('src/views/partials/listing-card.ejs');
const ticketPdf = read('src/services/pdf/ticketPdfService.js');
const archiveService = read('src/services/archive/archiveService.js');
const adminTravel = read('src/views/dashboards/shared/sections/admin-travel-supply-controls.ejs');
check('desktop bar image keeps the compact Vision Coaches height without stretching', css.includes('width:190px!important') && css.includes('height:150px!important') && css.includes('max-height:150px!important'));
const v1614Layer = (css.split('/* v1.6.14 —')[1] || '').split('/* v1.6.15 —')[0] || '';
check('v1.6.14 does not add a phone bar override', !/@media\(max-width:680px\)/.test(v1614Layer));
check('driver/front has a visible divider and deck gap', css.includes('padding:10px 10px 22px!important') && css.includes('border-bottom:1px dashed') && css.includes('margin-top:18px!important'));
check('dashboard seats emit authoritative visual state and inline taken red', seatMap.includes('data-seat-state') && seatMap.includes('seatVisualState') && seatMap.includes('background:#dc2626!important'));
check('desktop seat rows centre the aisle with equal side tracks', seatMap.includes('data-side-slots') && seatMap.includes('busSeatGroup--') && css.includes('grid-template-columns:var(--seat-side-width) 34px var(--seat-side-width)'));
check('listing seats emit authoritative visual state and inline taken red', details.includes('data-seat-state="${seatStatusClass(seat)}"') && details.includes('background:#dc2626!important'));
check('taken seats have final red override', css.includes('[data-seat-state="taken"]') && css.includes('background:#dc2626!important'));
check('route formatter uses bidirectional separator', route.includes('⇄') && route.includes('formatRouteLabel') && app.includes('res.locals.routeDisplay'));
check('cards, checkout and dashboards use the shared route display', listingCard.includes('ctRoute(') && bookingForm.includes('ctRoute(') && dashboard.includes('formatRouteLabel('));
check('PDFs, archives and mobility tables use bidirectional route display', ticketPdf.includes("formatRouteLabel(clean(reservation.pickupLocation") && archiveService.includes("return formatRouteLabel(row.fromStopName") && adminTravel.includes("ctRoute(row.pickup?.address"));
check('blocker fields exist in ScheduleRule schema', model.includes('materializationBlockedUntil') && model.includes('materializationBlockerCode'));
check('active blocker is never extended', materializer.includes('Never extend an existing active blocker') && materializer.includes('winnerBlocker'));
check('materialize cron queues work and returns quickly', materializer.includes('if (backgroundQueueOwner)') && materializer.includes('rulesQueued'));
check('worker owns rolling queue before cron registration', worker.indexOf('scheduleMaterializer.startWebFallback') < worker.indexOf('const jobs = startScheduledJobs'));
if (!process.exitCode) console.log(`v1.6.14 precision checks passed (${passed}/14).`);

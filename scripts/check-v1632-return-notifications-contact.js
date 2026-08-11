'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const busDomain = read('src/modules/bus/domain/busDomain.js');
const search = read('src/modules/bus/services/busSearchService.js');
const draft = read('src/modules/bus/services/busBookingDraftService.js');
const preview = read('src/views/pages/listing-details.ejs');
const notificationModel = read('src/models/Notification.js');
const notificationService = read('src/services/notification/notificationService.js');
const pushService = read('src/services/notification/pushService.js');
const notificationController = read('src/controllers/api/notificationController.js');
const notificationRoutes = read('src/routes/api/notifications.js');
const notificationJs = read('public/js/notifications.js');
const adminAction = read('src/controllers/admin/actionController.js');
const contact = read('src/views/partials/contact-hub.ejs');
const footer = read('src/views/partials/site-footer.ejs');
const workspace = read('src/views/dashboards/shared/workspace.ejs');
const render = read('render.yaml');
const app = read('src/app.js');
const home = read('src/views/pages/home.ejs');
const login = read('src/views/pages/auth/login.ejs');
let passed = 0;
function check(label, ok) {
  if (!ok) { console.error(`✗ ${label}`); process.exitCode = 1; }
  else { passed += 1; console.log(`✓ ${label}`); }
}
check('release version is 1.6.38', pkg.version === '1.6.43');
check('return discovery compares flexible location identity', busDomain.includes('function locationMatches') && search.includes('locationMatches(stop?.name, wantedName)'));
check('return preview no longer waits for outbound arrival', preview.includes('outboundDepartureTime') && !preview.includes('outboundFloor = new Date(outboundSchedule.arriveAt'));
check('return preview requires only a later future reverse departure', preview.includes('returnTime > Date.now()') && preview.includes('returnTime > outboundDepartureTime'));

check('return preview accepts any live reverse class', !preview.includes('normalizedTicketClass(item.vehicleClass) === activeTicketClass'));
check('reacquired return hold uses flexible reverse identity', draft.includes('const reverseJourney = holdsReverseJourney(outboundHold, hold);'));
check('round-trip draft accepts reverse branch/name identity', draft.includes('function holdsReverseJourney') && draft.includes('branchIdsReverse') && draft.includes('namesReverse'));
check('notification read state is persisted in Mongo schema', notificationModel.includes('readAt: { type: Date, index: true }'));
check('notification service supports mark all read', notificationService.includes('async function markAllRead') && notificationService.includes('updateMany'));
check('push subscription count and device resync exist', pushService.includes('activeSubscriptionCount') && notificationJs.includes('persistSubscription(subscription)'));
check('in-app notifications do not depend on service worker support', notificationJs.includes('if (!window.fetch) return;') && notificationJs.includes("if (!(\'serviceWorker\' in navigator)) return Promise.resolve(null);"));
check('push test endpoint exists', notificationController.includes('async function testPush') && notificationRoutes.includes("router.post('/test-push'"));
check('notification read-all endpoint exists', notificationRoutes.includes("router.post('/read-all'"));
check('admin notifications always include in-app', adminAction.includes("const channels = [...new Set(['in_app', ...requestedChannels])"));
check('contact hub has group, WhatsApp and direct call actions', contact.includes('Join WhatsApp group') && contact.includes('wa.me') && contact.includes('tel:'));
check('contact hub is global on public pages and dashboards', footer.includes("include('contact-hub')") && workspace.includes("include('../../partials/contact-hub')"));
check('support phone is configured everywhere through shared support config', contact.includes('+256781977217') && render.includes('+256781977217'));
check('canonical production origin uses www', render.includes('https://www.classictrip.org') && !render.includes('value: https://classictrip.org'));
check('apex domain redirects to www', app.includes("requestHost !== 'classictrip.org'") && app.includes('https://www.classictrip.org${req.originalUrl}'));
check('contact hub also covers home and auth surfaces', home.includes("include('../partials/contact-hub')") && login.includes("include('../../partials/contact-hub')"));
check('VAPID key generator is included', pkg.scripts['push:generate-keys'] === 'node scripts/generate-vapid-keys.js' && fs.existsSync(path.join(root, 'scripts/generate-vapid-keys.js')));
if (!process.exitCode) console.log(`v1.6.38 return/notification/contact checks passed (${passed}/${passed}).`);

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
  const relative = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(relative) : [relative];
});

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  passed += 1;
}

const approved = {
  'public/css/base.css': '653530243e926bc64e4cb2e733066dcb18586af8baa86ff8d8351701ab976ca5',
  'public/css/components.css': 'd6d52392225dd6c931954ae51cd658dc27f94601de35b025ae59b4b1a50e3965',
  'public/css/dashboard-workspace.css': '68c5a5b6e4b90fb4153430a043e64724865ddc9ca3d283386c366eb9f3865ab5',
  'public/css/pages/home.css': '3b979c081e7acdb5d8f8ba146912722a822aa4957e3924523c945b0b21882090',
  'public/css/pages/search.css': '9d628350e2fb57410892b042adba04a807e4e6d52de1ab279e288a0bad522b42',
  'public/css/pages/booking.css': '7e252f0ce1c3646c7be147d04be5fbd946aa91ffb34c79698ceb6850c6166075',
};
for (const [file, expected] of Object.entries(approved)) {
  check(hash(file) === expected, `${file} must remain identical to the uploaded approved UI`);
}

const removed = [
  'public/css/accessibility.css',
  'public/css/auth-layout-polish.css',
  'public/css/dashboard-final-polish.css',
  'public/css/final-system-audit.css',
  'public/css/platform-layout-polish.css',
  'public/css/production-ui-lock.css',
];
removed.forEach((file) => check(!exists(file), `${file} must not be present`));

const safe = read('public/css/accessibility-safe.css');
check(safe.includes(':focus-visible'), 'Safe focus visibility must exist');
check(safe.includes('prefers-reduced-motion: reduce'), 'Reduced-motion support must exist');
check(safe.includes('forced-colors: active'), 'Forced-colours support must exist');
check(!/(?:min-height|height|width|border-radius|grid-template-columns|position|transform)\s*:/.test(safe), 'Accessibility layer must not alter approved geometry');
check(!/html\[data-theme|\bbody\s*\{/.test(safe), 'Accessibility layer must not replace approved themes or page surfaces');

const publicScoped = read('public/css/four-service-ui.css');
const dashboardScoped = read('public/css/dashboard-service-additions.css');
const travelScoped = read('public/css/pages/travel-booking.css');
check(publicScoped.includes('.partnersDirectoryPage') && publicScoped.includes('.supportPage'), 'New marketing styles must remain page-scoped');
check(!/(^|})\s*(body|html|\.container|\.card|\.btn)\s*\{/m.test(publicScoped), 'New marketing stylesheet must not redefine global reference selectors');
check(dashboardScoped.includes('.adminSupplyControl') && dashboardScoped.includes('.hotelSetupJourney'), 'New dashboard service styles must remain feature-scoped');
check(!/(^|})\s*(body|html|\.sidebar|\.main|\.sideNav|\.navBtn)\s*\{/m.test(dashboardScoped), 'New dashboard stylesheet must not reshape the reference dashboard shell');
check(travelScoped.includes('.travelPage') && travelScoped.includes('.liveMap'), 'Flight and mobility extensions must have scoped layout and real map styling');
check(!/(^|})\s*(body|html|\.container|\.nav|\.sidebar|\.main)\s*\{/m.test(travelScoped), 'Travel stylesheet must not redefine global public or dashboard shells');

const views = walk('src/views').filter((file) => file.endsWith('.ejs'));
const obsoleteNames = removed.map((file) => path.basename(file));
for (const file of views) {
  const source = read(file);
  check(!obsoleteNames.some((name) => source.includes(name)), `${file} must not load an obsolete global stylesheet`);
}

const fullDocuments = views.filter((file) => /<head(?:\s|>)/i.test(read(file)));
for (const file of fullDocuments) {
  check(read(file).includes('/css/accessibility-safe.css'), `${file} must load the non-destructive accessibility layer`);
}

for (const file of ['src/views/pages/flights.ejs','src/views/pages/flight-order.ejs','src/views/pages/taxi.ejs','src/views/pages/taxi-track.ejs']) {
  const source = read(file);
  check(source.indexOf('/css/accessibility-safe.css') > source.indexOf('/css/pages/travel-booking.css'), `${file} must load accessibility after scoped travel styling`);
}

const serviceRegistry = read('src/config/serviceRegistry.js');
for (const service of ['bus','hotel','flight','local_transport','tour','car_rental','cargo']) {
  check(new RegExp(`${service}:[\\s\\S]*status: 'active'[\\s\\S]*bookable: true`).test(serviceRegistry), `${service} must remain active and bookable`);
}

const applicationSources = [...walk('src'), ...walk('public')]
  .filter((file) => /\.(js|ejs|css|json|txt)$/i.test(file));
const prohibited = applicationSources.filter((file) => /\b(ferry|ferries|train|trains)\b/i.test(read(file)));
check(prohibited.length === 0, `Removed Ferry/Train services must not return: ${prohibited.join(', ')}`);

check(read('src/views/pages/taxi.ejs').includes('taxiMap'), 'Local mobility must retain the real customer map');
check(read('public/js/taxi.js').includes('L.map') && read('public/js/taxi.js').includes('route.geometry'), 'Local mobility must retain road-route rendering');
check(read('src/views/pages/flights.ejs').includes('flightSearchForm'), 'Flight-agent customer search must remain connected');
check(read('src/views/dashboards/shared/workspace.ejs').includes('/css/dashboard-service-additions.css'), 'Dashboard must retain scoped four-service additions');

console.log(`Reference UI merge verification passed (${passed}/${passed}).`);

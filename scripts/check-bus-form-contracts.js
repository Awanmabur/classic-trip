'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const failures = [];
let checks = 0;

function assert(condition, message) {
  checks += 1;
  if (!condition) failures.push(message);
}

const repository = read('src/modules/bus/repositories/busRepository.js');
const setup = read('src/modules/bus/services/busSetupService.js');
const departures = read('src/modules/bus/services/busDepartureService.js');
const errors = read('src/middlewares/errorHandler.js');
const companyRoutes = read('src/routes/web/company.js');
const dashboard = read('public/js/dashboard-workspace.js');
const csrfBrowser = read('public/js/csrf.js');
const onboarding = read('src/services/company/busServiceOnboarding.js');

assert(!/\bversion:\s*0\b/.test(setup), 'Bus routes must never be created below the Route schema minimum version.');
assert(/version:\s*1,/.test(setup), 'New routes must begin at version 1.');
assert(/routeOrThrow\(companyId, routeId, session \? \{ session \} : \{\}\)/.test(setup), 'Route rebuild must read inside the active MongoDB transaction.');
assert(/async function oneOrThrow\(collection, filter, message, options = \{\}\)/.test(repository), 'Repository throw helpers must accept query/session options.');
assert(/collection\.findOne\(filter, options\)/.test(repository), 'Repository throw helpers must pass the session to MongoDB reads.');
assert(/topic:\s*eventType/.test(repository), 'Every bus outbox event must populate the required topic field.');
assert(/selectedIntermediateStops/.test(setup), 'Selected boarding/drop-off branches must become canonical route-stop records.');
assert(/routeStops\.saveMany\(\[originStop, \.\.\.intermediateStops, destinationStop\]/.test(setup), 'Route creation must save all selected stops in one unit of work.');
assert(/boardingBranchIds:\s*\[\.\.\.new Set\(stops\.filter/.test(setup), 'Route boarding/drop-off metadata must derive from active route stops.');
assert(/A route cannot be moved to another bus listing/.test(setup), 'Unsafe route parent reassignment must be rejected explicitly.');
assert(/The selected origin is already an intermediate stop/.test(setup), 'Endpoint edits must reject duplicate stop relationships.');
assert(!/const stopCandidates = \[\]/.test(onboarding), 'The wizard must not duplicate route stops already handled by createRoute.');

assert(/columnsForLayout\(layoutName\)/.test(setup), 'Vehicle creation must derive columns from the selected seat layout.');
assert(/A vehicle cannot be moved to another bus listing/.test(setup), 'Unsafe vehicle parent reassignment must be rejected explicitly.');
assert(/A vehicle with this registration or fleet code already exists/.test(setup), 'Vehicle edits must enforce registration/fleet-code uniqueness.');
assert(/This vehicle is assigned to active or future departures/.test(setup), 'Vehicle maintenance/archive changes must protect active departures.');
assert(/blockedSeats:\s*parseList\(payload\.blockedSeats\)|\bblockedSeats,/.test(departures), 'Recurring schedule rules must save blocked seats from the form.');

assert(/normalizeOperationalError/.test(errors), 'The global error handler must normalize expected database errors.');
assert(/error\.name === 'ValidationError'/.test(errors), 'Mongoose validation errors must become form validation responses.');
assert(/Number\(error\.code\) === 11000/.test(errors), 'MongoDB duplicate errors must become conflict responses.');
assert(/error\.name === 'CastError'/.test(errors), 'MongoDB cast errors must become field validation responses.');
assert(/error\.publicMessage/.test(errors), 'Safe actionable form errors must be displayed instead of the generic 500 fallback.');

const multipartRoutes = [
  /router\.post\('\/company\/bus-services',[\s\S]*?upload\.fields\([\s\S]*?requireCsrfToken, onboardingController\.createBusService\);/,
  /router\.post\('\/company\/listings', upload\.single\('imageFile'\), requireCsrfToken,/,
  /router\.post\('\/company\/listings\/:id', upload\.single\('imageFile'\), requireCsrfToken,/,
  /router\.post\('\/company\/vehicles',[^\n]*upload\.single\('imageFile'\), requireCsrfToken,/,
  /router\.post\('\/company\/vehicles\/:id',[^\n]*upload\.single\('imageFile'\), requireCsrfToken,/,
];
for (const routePattern of multipartRoutes) {
  assert(routePattern.test(companyRoutes), `Multipart route is missing upload -> CSRF -> controller ordering: ${routePattern}`);
}

const requiredPostEndpoints = [
  '/company/bus-services',
  '/company/routes',
  '/company/vehicles',
  '/company/vehicles/seat-template',
  '/company/fares',
  '/company/fare-segments',
  '/company/schedules',
  '/company/schedule-rules',
  '/company/seats/status',
  '/company/bookings',
  '/company/scanner/validate',
  '/company/scanner/no-show',
];
for (const endpoint of requiredPostEndpoints) {
  assert(dashboard.includes(endpoint), `Dashboard form/action is missing endpoint ${endpoint}.`);
}

assert(/form\.addEventListener\(['"]submit['"]/.test(csrfBrowser) || /document\.addEventListener\(['"]submit['"]/.test(csrfBrowser), 'Browser CSRF logic must synchronize forms at submit time.');
assert(/FormData/.test(csrfBrowser), 'Browser CSRF logic must cover multipart FormData submissions.');
assert(/X-CSRF-Token|X-XSRF-TOKEN/i.test(csrfBrowser), 'Browser requests must send a CSRF header.');
assert(/name:'listingId', type:'hidden'.*route\.listingId/.test(dashboard), 'Route edits must preserve, not reassign, their parent listing.');
assert(/name:'listingId', type:'hidden'.*vehicle\.listingId/.test(dashboard), 'Vehicle edits must preserve, not reassign, their parent listing.');
assert(dashboard.includes('/company/vehicles/seat-template'), 'Seat-map geometry must have its own versioned form.');

if (failures.length) {
  console.error(`Bus form contract verification failed (${failures.length}/${checks}):`);
  failures.forEach((failure, index) => console.error(`${index + 1}. ${failure}`));
  process.exit(1);
}

console.log(`Bus form contract verification passed (${checks}/${checks}).`);

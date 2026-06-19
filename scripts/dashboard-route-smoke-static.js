const fs = require('fs');
const path = require('path');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

const companyRoutes = read('src/routes/web/company.js');
const dashboard = read('src/views/dashboards/admin/index.ejs');
const app = read('src/app.js');
const errorHandler = read('src/middlewares/errorHandler.js');
const flash = read('src/middlewares/flash.js');

const requiredRoutes = [
  '/company/dashboard',
  '/company/bus-listings',
  '/company/routes-stops',
  '/company/vehicles',
  '/company/schedules-fares',
  '/company/seat-maps',
  '/company/passenger-manifests',
  '/company/boarding-checkins',
  '/company/hotel-properties',
  '/company/room-types',
  '/company/room-units',
  '/company/room-calendar',
  '/company/housekeeping',
  '/company/arrivals',
  '/company/in-house-guests',
  '/company/departures',
  '/company/revenue',
  '/company/settlement',
  '/company/reports',
];

const requiredDashboardMarkers = [
  'data-flash-stack',
  'actionFlashStack',
  'validateActionForm',
  'Visual seat preview',
  'Room-night calendar',
  'companyHousekeepingTable',
  'Seat No',
  'hotelCalendarGrid',
  'seatPageShell',
  'Booking-level revenue ledger',
  'companySettlementLedgerTable',
  'companyPayoutRequestTable',
  'companyFinanceStatementTable',
];

const requiredFlashMarkers = [
  'flashMiddleware',
  'pushFlash',
  'Saved successfully.',
  'Published successfully.',
  'Housekeeping updated successfully.',
];

const failures = [];
requiredRoutes.forEach((route) => {
  if (!companyRoutes.includes(route)) failures.push(`Missing company dashboard route: ${route}`);
});
requiredDashboardMarkers.forEach((marker) => {
  if (!dashboard.includes(marker)) failures.push(`Missing dashboard marker: ${marker}`);
});
requiredFlashMarkers.forEach((marker) => {
  if (!flash.includes(marker)) failures.push(`Missing flash marker: ${marker}`);
});
if (!app.includes("require('./middlewares/flash')") || !app.includes('app.use(flashMiddleware)')) {
  failures.push('Flash middleware is not mounted in src/app.js');
}
if (!errorHandler.includes('pushFlash') || !errorHandler.includes('res.redirect(safeBack(req))')) {
  failures.push('Error handler does not redirect POST failures back with flash feedback');
}
if (!fs.existsSync(path.join(__dirname, '..', 'tests/e2e/companyDashboardSmoke.test.js'))) {
  failures.push('Missing executable dashboard route smoke test file');
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Dashboard route smoke static validation passed.');

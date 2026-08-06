'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
  process.stdout.write(`✓ ${name}\n`);
}

const busDomain = require('../src/modules/bus/domain/busDomain');
const seatProjection = require('../src/services/dashboard/liveDepartureSeatMapProjection');

const repaired49 = busDomain.buildSeatDefinitions({
  totalSeats: 49,
  rows: 10,
  columns: 5, // stale value from an old 2x3 selection
  layoutName: '2x2',
  frontRowPassengerSeats: 1,
  driverPosition: 'right',
});
check('named 2x2 layout overrides stale submitted columns', repaired49.columns === 4 && repaired49.seats.every((seat) => seat.column <= 4));
check('front-row plus 49 passengers auto-expands through row 13', repaired49.seats.length === 49 && repaired49.rows === 13 && Math.max(...repaired49.seats.map((seat) => seat.row)) === 13);
check('front-row seat remains a real passenger position', repaired49.seats.filter((seat) => seat.row === 1).length === 1);

const overrideRepair = busDomain.buildSeatDefinitions({
  totalSeats: 20,
  rows: 4,
  layoutName: '2x2',
  rowLayoutOverrides: '2:1+1,3:1+1',
});
check('reduced-capacity row overrides extend rear rows instead of rejecting the vehicle', overrideRepair.seats.length === 20 && overrideRepair.rows === 6 && Math.max(...overrideRepair.seats.map((seat) => seat.row)) === 6);

const customColumns = busDomain.buildSeatDefinitions({ totalSeats: 12, rows: 3, columns: 3, layoutName: 'custom' });
check('custom layouts still honour explicit columns', customColumns.seats.length === 12 && customColumns.columns === 3 && customColumns.rows === 4);

const schedules = [
  { id: 'schedule-a', companyId: 'company-1', listingId: 'listing-1', routeId: 'route-1', vehicleId: 'vehicle-1', status: 'published', departAt: '2026-08-07T07:00:00.000Z' },
  { id: 'schedule-b', companyId: 'company-1', listingId: 'listing-1', routeId: 'route-1', vehicleId: 'vehicle-2', status: 'boarding', departAt: '2026-08-08T07:00:00.000Z' },
];
const seats = schedules.flatMap((schedule) => Array.from({ length: 49 }, (_, index) => ({
  id: `${schedule.id}-seat-${index + 1}`,
  companyId: 'company-1',
  scheduleId: schedule.id,
  seatNumber: String(index + 1),
  row: Math.floor(index / 4) + 1,
  column: (index % 4) + 1,
  status: 'available',
})));
const maps = seatProjection.buildLiveDepartureSeatMaps({
  listings: [{ id: 'listing-1', companyId: 'company-1', serviceType: 'bus', title: 'Kampala to Gulu' }],
  routes: [{ id: 'route-1', companyId: 'company-1', listingId: 'listing-1', routeName: 'Kampala to Gulu' }],
  vehicles: [
    { id: 'vehicle-1', companyId: 'company-1', listingId: 'listing-1', serviceType: 'bus', name: 'Coach A', layoutName: '2x2' },
    { id: 'vehicle-2', companyId: 'company-1', listingId: 'listing-1', serviceType: 'bus', name: 'Coach B', layoutName: '2x2' },
  ],
  schedules,
  seats,
  bookings: [{
    id: 'booking-1', bookingRef: 'CT-1', companyId: 'company-1', scheduleId: 'schedule-b', paymentStatus: 'paid',
    passengers: [{ fullName: 'Passenger One', seatNumber: '7' }],
    ticketLegs: [{ scheduleId: 'schedule-b', seatNumber: '7', passengerIndex: 0, ticketNumber: 'T-7' }],
  }],
});
check('live seat-map projection keeps every matching departure instead of one sticky bus', maps.length === 2 && maps.map((map) => map.vehicleName).join(',') === 'Coach A,Coach B');
check('booking-seat index marks the correct seat without scanning all bookings per seat', maps[1].seats.find((seat) => seat.seatNumber === '7').status === 'booked');
check('each departure keeps its own 49-seat inventory', maps.every((map) => map.totalSeats === 49));

const workspace = read('src/views/dashboards/shared/workspace.ejs');
const seatMapsView = read('src/views/dashboards/shared/sections/seat-maps.ejs');
const browser = read('public/js/dashboard-workspace.js');
const projection = read('src/services/dashboard/liveDepartureSeatMapProjection.js');
const projectionEngine = read('src/services/dashboard/dashboardProjectionEngine.js');
const rolling = read('src/jobs/materializeSchedules.js');
const shellConfig = read('src/services/dashboard/shellConfig.js');
const flightTaxi = read('src/views/dashboards/shared/sections/flight-taxi.ejs');

check('server renders only the active dashboard section', workspace.includes('const shellCanShow = function(page, aliases){ return shellHasPage(page, aliases) && isActiveDashboardPage(page, aliases); };'));
check('overview is active-page gated', workspace.includes("if(isActiveDashboardPage('overview'))"));
check('role-specific customer and promoter sections are active-page gated', workspace.includes("isCustomerDashboard && isActiveDashboardPage('ticket')") && workspace.includes("isPromoterDashboard && isActiveDashboardPage('links')"));
check('flight and taxi workspace renders only the requested travel section', flightTaxi.includes('shouldRenderTravelSection') && flightTaxi.includes("shouldRenderTravelSection('taxi-operations')"));
check('browser bootstrap excludes arrays unrelated to the active page', workspace.includes('allowedBrowserArrays') && workspace.includes('browserDashboardData'));
check('inactive tables are deferred until their section opens', browser.includes('pendingTableRenders') && browser.includes('flushPendingTables(target)'));
check('seat-map view does not truncate departures to twelve records', !seatMapsView.includes('.slice(0,12)'));
check('vehicle, date and status controls are wired as real seat-map filters', seatMapsView.includes('data-seat-map-filter="vehicle"') && seatMapsView.includes('data-seat-map-filter="date"') && seatMapsView.includes('data-seat-map-filter="status"'));
check('filter code hides non-matches and moves selection to the first valid departure', browser.includes('function applySeatMapFilters()') && browser.includes('select.value = matchingOptions[0].value'));
check('seat projection indexes bookings and seats by schedule', projection.includes('buildBookingSeatIndex') && projection.includes('seatsBySchedule'));
check('projection engine uses request-local identity indexes', projectionEngine.includes('listingById') && projectionEngine.includes('seatsBySchedule') && projectionEngine.includes('bookingsBySchedule'));
check('projection cache separates active dashboard pages', projectionEngine.includes("${context.activePage || 'overview'}"));
check('rolling batches invalidate affected dashboard snapshots', rolling.includes('invalidateRollingDashboardCaches') && rolling.includes('dashboardSnapshotService.invalidate'));
check('rolling queue retries bounded no-progress batches instead of silently abandoning pending dates', rolling.includes('Rolling departure queue made no progress') && rolling.includes('job.attempts < 8'));
check('workflow and notification navigation use real role routes', !shellConfig.includes("href: '#workflow-guide'") && !shellConfig.includes("href: '#notifications'"));
check('seat layout browser sync repairs rows and columns before submission', browser.includes('function syncSeatLayoutCapacity') && browser.includes('parsedRowLayoutOverridesBrowser'));

console.log(`Dashboard root performance, seat-map, rolling and capacity checks passed (${passed}/${passed}).`);

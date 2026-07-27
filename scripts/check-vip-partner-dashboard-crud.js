'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { buildSeatDefinitions } = require('../src/modules/bus/domain/busDomain');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const files = {
  workspace: read('public/js/dashboard-workspace.js'),
  companyRoutes: read('src/routes/web/company.js'),
  companyService: read('src/services/company/companyService.js'),
  busSetup: read('src/modules/bus/services/busSetupService.js'),
  departures: read('src/modules/bus/services/busDepartureService.js'),
  hotelService: read('src/services/hotel/hotelService.js'),
  projection: read('src/services/dashboard/dashboardProjectionEngine.js'),
  snapshot: read('src/services/dashboard/dashboardSnapshotService.js'),
  shell: read('src/services/dashboard/shellConfig.js'),
  menus: read('src/config/dashboardMenus.js'),
  vehicleModel: read('src/models/Vehicle.js'),
  templateModel: read('src/models/SeatMapTemplate.js'),
  versionModel: read('src/models/SeatMapVersion.js'),
  migration: read('scripts/migrate-vip-vehicle-class.js'),
  scheduleController: read('src/controllers/company/scheduleController.js'),
  operationsController: read('src/controllers/company/operationsController.js'),
  hotelController: read('src/controllers/company/hotelController.js'),
};

const checks = [];
function check(label, fn) {
  try {
    fn();
    checks.push({ label, ok: true });
    console.log(`PASS ${label}`);
  } catch (error) {
    checks.push({ label, ok: false, error: error.message });
    console.error(`FAIL ${label}: ${error.message}`);
  }
}
function contains(fileKey, pattern, label) {
  check(label, () => {
    const source = files[fileKey];
    if (pattern instanceof RegExp) assert(pattern.test(source), `Missing ${pattern}`);
    else assert(source.includes(pattern), `Missing ${pattern}`);
  });
}
function notContains(fileKey, pattern, label) {
  check(label, () => {
    const source = files[fileKey];
    if (pattern instanceof RegExp) assert(!pattern.test(source), `Unexpected ${pattern}`);
    else assert(!source.includes(pattern), `Unexpected ${pattern}`);
  });
}

// VIP is a vehicle-wide class, never an individually priced seat upgrade.
check('VIP class applies to every sellable passenger seat', () => {
  const map = buildSeatDefinitions({ totalSeats: 12, rows: 3, columns: 4, vehicleClass: 'vip' });
  const passengerSeats = map.seats.filter((seat) => seat.seatType !== 'crew');
  assert(passengerSeats.length === 12);
  assert(passengerSeats.every((seat) => seat.seatClass === 'VIP'));
});
check('VIP seats do not receive per-seat price differences', () => {
  const map = buildSeatDefinitions({ totalSeats: 8, rows: 2, columns: 4, vehicleClass: 'vip', vipPriceDelta: 50000 });
  assert(map.seats.every((seat) => Number(seat.priceDelta || 0) === 0));
});
check('Accessible seat on a VIP vehicle remains VIP class', () => {
  const map = buildSeatDefinitions({ totalSeats: 4, rows: 1, columns: 4, vehicleClass: 'vip', accessibleSeats: ['2'] });
  assert.strictEqual(map.seats[1].seatClass, 'VIP');
  assert.strictEqual(map.seats[1].seatType, 'accessible');
});
check('Explicit standard vehicle ignores legacy per-seat VIP input', () => {
  const map = buildSeatDefinitions({ totalSeats: 4, rows: 1, columns: 4, vehicleClass: 'standard', vipSeats: ['1', '2'] });
  assert(map.seats.every((seat) => seat.seatClass === 'Standard'));
});
contains('vehicleModel', "vehicleClass: { type: String, enum: ['standard', 'vip']", 'Vehicle schema stores one vehicle class');
contains('templateModel', "vehicleClass: { type: String, enum: ['standard', 'vip']", 'Seat-map template stores vehicle class');
contains('versionModel', "vehicleClass: { type: String, enum: ['standard', 'vip']", 'Published seat-map version stores vehicle class');
contains('busSetup', 'vehicleClassChanged && vehicle.activeSeatMapVersionId', 'Changing vehicle class publishes a replacement seat-map version');
contains('busSetup', 'defaultSeatClass: seatClassForVehicleClass(vehicleClass)', 'Compatibility vehicle data inherits the vehicle class');
contains('busSetup', 'vipPriceDelta: 0', 'Current seat-map writes force VIP seat difference to zero');
contains('workspace', 'VIP vehicle — every passenger seat is VIP', 'Vehicle creation explains whole-vehicle VIP');
contains('workspace', 'VIP applies to the complete vehicle and its full passenger seat map', 'Vehicle editing explains whole-vehicle VIP');
notContains('workspace', "name:'vipSeats'", 'Dashboard no longer exposes per-seat VIP selection');
notContains('workspace', "name:'priceDelta', label:'Price delta'", 'Seat status forms no longer expose per-seat price changes');
contains('migration', 'priceDelta: 0', 'VIP migration removes historical per-seat price differences');
contains('migration', "vehicleClass === 'vip' ? 'VIP' : 'Standard'", 'VIP migration normalises every passenger seat from vehicle class');

// Service navigation across all dashboard roles.
contains('menus', "page: 'tour-dashboard', label: 'Tour Operators'", 'Superadmin sidebar includes tour operators');
contains('menus', "page: 'rental-dashboard', label: 'Car Rentals'", 'Superadmin sidebar includes car rentals');
contains('menus', "page: 'cargo-dashboard', label: 'Cargo Providers'", 'Superadmin sidebar includes cargo providers');
contains('menus', "page: 'tour-dashboard', label: 'Tour Campaigns'", 'Promoter sidebar includes tour campaigns');
contains('menus', "page: 'rental-dashboard', label: 'Car Rental Campaigns'", 'Promoter sidebar includes car-rental campaigns');
contains('menus', "page: 'cargo-dashboard', label: 'Cargo Campaigns'", 'Promoter sidebar includes cargo campaigns');
contains('shell', 'tour: {', 'Partner service sidebar has tour configuration');
contains('shell', 'car_rental: {', 'Partner service sidebar has car-rental configuration');
contains('shell', 'cargo: {', 'Partner service sidebar has cargo configuration');
contains('shell', "label: 'Stay & Airbnb Listings'", 'Stay partner sidebar explicitly includes Airbnb');
contains('shell', "label: 'Promote Bus Services'", 'Bus partner sidebar includes promotion workspace');
contains('shell', "label: 'Promote Stays & Airbnb'", 'Stay partner sidebar includes promotion workspace');
contains('shell', "label: 'Assigned Tour Bookings'", 'Tour staff sidebar is service-specific');
contains('shell', "label: 'Assigned Rentals'", 'Car-rental staff sidebar is service-specific');
contains('shell', "label: 'Assigned Shipments'", 'Cargo staff sidebar is service-specific');

// Company-scoped CRUD routes.
[
  ["router.post('/company/listings'", 'Listing create route'],
  ["router.post('/company/listings/:id'", 'Listing update route'],
  ["router.post('/company/listings/:id/publish'", 'Listing publish route'],
  ["router.post('/company/listings/:id/archive'", 'Listing archive route'],
  ["router.post('/company/routes'", 'Route create route'],
  ["router.post('/company/routes/:id'", 'Route update route'],
  ["router.post('/company/routes/:id/archive'", 'Route archive route'],
  ["router.post('/company/routes/:id/stops'", 'Route-stop create route'],
  ["router.post('/company/route-stops/:stopId'", 'Route-stop update route'],
  ["router.post('/company/route-stops/:stopId/archive'", 'Route-stop archive route'],
  ["router.post('/company/vehicles'", 'Vehicle create route'],
  ["router.post('/company/vehicles/:id'", 'Vehicle update route'],
  ["router.post('/company/vehicles/:id/archive'", 'Vehicle archive route'],
  ["router.post('/company/vehicles/:id/seats'", 'Vehicle seat-map update route'],
  ["router.post('/company/schedules'", 'Departure create route'],
  ["router.post('/company/schedules/:id'", 'Departure update route'],
  ["router.post('/company/schedules/:id/publish'", 'Departure publish route'],
  ["router.post('/company/schedules/:id/archive'", 'Departure archive route'],
  ["router.post('/company/schedule-rules'", 'Recurring departure create route'],
  ["router.post('/company/schedule-rules/:id'", 'Recurring departure update route'],
  ["router.post('/company/schedule-rules/:id/pause'", 'Recurring departure pause route'],
  ["router.post('/company/schedule-rules/:id/resume'", 'Recurring departure resume route'],
  ["router.post('/company/schedule-rules/:id/cancel'", 'Recurring departure cancel route'],
  ["router.post('/company/fares'", 'Fare-plan create route'],
  ["router.post('/company/fares/:id'", 'Fare-plan update route'],
  ["router.post('/company/fares/:id/archive'", 'Fare-plan archive route'],
  ["router.post('/company/fare-segments'", 'Stop-fare upsert route'],
  ["router.post('/company/fare-segments/:id/archive'", 'Stop-fare archive route'],
  ["router.post('/company/addons'", 'Service add-on create route'],
  ["router.post('/company/addons/:id'", 'Service add-on update route'],
  ["router.post('/company/addons/:id/archive'", 'Service add-on archive route'],
  ["router.post('/company/branches'", 'Branch create route'],
  ["router.post('/company/branches/:id'", 'Branch update route'],
  ["router.post('/company/branches/:id/archive'", 'Branch archive route'],
  ["router.post('/company/policies'", 'Policy create route'],
  ["router.post('/company/policies/:id'", 'Policy update route'],
  ["router.post('/company/policies/:id/archive'", 'Policy archive route'],
  ["router.post('/company/staff/:id/role'", 'Staff update route'],
  ["router.post('/company/staff/:id/archive'", 'Staff revoke route'],
  ["router.post('/company/drivers/:id/profile'", 'Driver update route'],
  ["router.post('/company/drivers/:id/activate'", 'Driver activation route'],
  ["router.post('/company/drivers/:id/archive'", 'Driver revoke route'],
  ["router.post('/company/invitations/:id/resend'", 'Invitation resend route'],
  ["router.post('/company/invitations/:id/revoke'", 'Invitation revoke route'],
  ["router.post('/company/promotions'", 'Promotion create route'],
  ["router.post('/company/promotions/:id'", 'Promotion update route'],
  ["router.post('/company/promotions/:id/pause'", 'Promotion pause route'],
  ["router.post('/company/promotions/:id/resume'", 'Promotion resume route'],
  ["router.post('/company/promotions/:id/end'", 'Promotion end route'],
  ["router.post('/company/support/:id'", 'Support response route'],
  ["router.post('/company/reviews/:id/reply'", 'Review reply route'],
].forEach(([needle, label]) => contains('companyRoutes', needle, label));

// Normalised stay/Airbnb lifecycle.
[
  ["router.post('/company/hotels/properties'", 'Property create route'],
  ["router.post('/company/hotels/properties/:id'", 'Property update route'],
  ["router.post('/company/hotels/properties/:id/archive'", 'Property archive route'],
  ["router.post('/company/hotels/room-types'", 'Room-type create route'],
  ["router.post('/company/hotels/room-types/:id'", 'Room-type update route'],
  ["router.post('/company/hotels/room-types/:id/archive'", 'Room-type archive route'],
  ["router.post('/company/hotels/rate-plans'", 'Rate-plan create route'],
  ["router.post('/company/hotels/rate-plans/:id'", 'Rate-plan update route'],
  ["router.post('/company/hotels/rate-plans/:id/archive'", 'Rate-plan archive route'],
  ["router.post('/company/hotels/room-units'", 'Room-unit create route'],
  ["router.post('/company/hotels/room-units/:id'", 'Room-unit update route'],
  ["router.post('/company/hotels/room-units/:id/archive'", 'Room-unit archive route'],
  ["router.post('/company/hotels/inventory'", 'Room-night create route'],
  ["router.post('/company/hotels/inventory/:id/status'", 'Room-night update route'],
  ["router.post('/company/hotels/inventory/:id/archive'", 'Room-night archive route'],
].forEach(([needle, label]) => contains('companyRoutes', needle, label));

// Every mutable dashboard entity has a real edit form and canonical detail.
contains('workspace', "mode === 'edit' && key === 'listing'", 'Listing edit form exists');
contains('workspace', "mode === 'edit' && key === 'route'", 'Route edit form exists');
contains('workspace', "key === 'route_stop'", 'Route-stop edit form accepts canonical entity key');
contains('workspace', "mode === 'edit' && key === 'vehicle'", 'Vehicle edit form exists');
contains('workspace', "mode === 'edit' && key === 'schedule'", 'Departure edit form exists');
contains('workspace', "key === 'schedule_rule'", 'Recurring departure edit form accepts canonical entity key');
contains('workspace', "mode === 'edit' && key === 'room'", 'Legacy room inventory edit form exists');
contains('workspace', "mode === 'edit' && key === 'hotel_property'", 'Property edit form exists');
contains('workspace', "mode === 'edit' && key === 'room_type'", 'Room-type edit form exists');
contains('workspace', "mode === 'edit' && key === 'rate_plan'", 'Rate-plan edit form exists');
contains('workspace', "mode === 'edit' && key === 'room_unit'", 'Room-unit edit form exists');
contains('workspace', "mode === 'edit' && key === 'room_night'", 'Room-night edit form exists');
contains('workspace', "key === 'service_addon'", 'Add-on edit form accepts canonical entity key');
contains('workspace', "key === 'fare_product'", 'Fare edit form accepts canonical entity key');
contains('workspace', "key === 'segment_fare'", 'Segment-fare edit form accepts canonical entity key');
contains('workspace', "key === 'branch'", 'Branch create/edit form exists');
contains('workspace', "key === 'policy'", 'Policy create/edit form exists');
contains('workspace', "key === 'promotion'", 'Promotion create/edit form exists');
contains('workspace', "key === 'staff status'", 'Staff canonical edit form exists');
contains('workspace', "key === 'driver profile'", 'Driver canonical edit form exists');
contains('workspace', "type === 'schedule_rule'", 'Recurring departure smart form synchronises underscore entity key');
contains('workspace', "detail?.scheduleRule?.id", 'Recurring departure edit resolves the real record id');
contains('workspace', "name:'viewType'", 'Room-unit edit preserves view data');
contains('workspace', "name:'accessible'", 'Room-unit edit preserves accessibility data');
contains('workspace', "name:'closedToArrival'", 'Room-night edit preserves arrival controls');
contains('workspace', "name:'minStay'", 'Room-night edit preserves stay limits');

// Backend edit services save the same fields presented by the forms.
contains('companyService', 'async function updateEmployeeRole', 'Staff update service exists');
contains('companyService', "employee.fullName = fullName", 'Staff name edit persists');
contains('companyService', "employee.email = email", 'Staff email edit persists');
contains('companyService', 'employee.listingIds = scopes.listingIds', 'Staff listing scope edit persists');
contains('companyService', 'employee.scheduleIds = scopes.scheduleIds', 'Staff schedule scope edit persists');
contains('companyService', 'async function updateDriverProfile', 'Driver update service exists');
contains('companyService', 'employee.licenseNumber =', 'Driver licence edit persists');
contains('companyService', 'employee.safetyStatus =', 'Driver safety edit persists');
contains('companyService', 'employee.assignedFleetId =', 'Driver vehicle assignment persists');
contains('companyService', 'async function updateBranch', 'Branch update service exists');
contains('companyService', 'async function archiveBranch', 'Branch archive service exists');
contains('companyService', 'async function updatePolicy', 'Policy update service exists');
contains('companyService', 'async function archivePolicy', 'Policy archive service exists');
contains('hotelService', 'async function updateRoomType', 'Room-type update service exists');
contains('hotelService', 'async function updateRoomUnit', 'Room-unit update service exists');
contains('hotelService', "['floor','wing','viewType','notes']", 'Room-unit view and position edits persist');
contains('hotelService', "['accessible','smokingAllowed','connectingRoom']", 'Room-unit attribute edits persist');
contains('hotelService', 'async function updateNightStatus', 'Room-night update service exists');
contains('hotelService', "Object.prototype.hasOwnProperty.call(payload, 'price')", 'Room-night price edit persists');
contains('hotelService', "Object.prototype.hasOwnProperty.call(payload, 'closedToArrival')", 'Room-night arrival closure edit persists');
contains('hotelService', "Object.prototype.hasOwnProperty.call(payload, 'minStay')", 'Room-night stay-limit edit persists');
contains('hotelService', 'payload.housekeepingStatus', 'Room-night housekeeping edit updates the linked unit');
contains('departures', 'async function updateScheduleRule', 'Recurring schedule update service exists');
contains('scheduleController', 'async function updateRule', 'Recurring schedule update controller exists');
contains('snapshot', "'scheduleRules'", 'Company snapshot loads recurring schedule rules');
contains('projection', 'scheduleRuleRows', 'Recurring schedule rules render in the dashboard');

// Service-specific listing CRUD remains end to end for new partner services.
contains('companyService', "const supported = ['hotel', 'tour', 'car_rental', 'cargo']", 'Generic listing service supports tours, rentals, cargo, and stays');
contains('companyService', "tour: 'experience'", 'Tour listing domain data is created');
contains('companyService', "car_rental: 'rental_vehicle'", 'Car-rental listing domain data is created');
contains('companyService', "cargo: 'cargo_service'", 'Cargo listing domain data is created');
contains('companyService', "availabilityModes = { hotel: 'date_range', tour: 'dated_capacity', car_rental: 'date_range', cargo: 'on_demand' }", 'Service-specific availability modes are persisted');
contains('companyService', "pricingUnits = { hotel: 'per_night', tour: 'per_person', car_rental: 'per_day', cargo: 'per_shipment' }", 'Service-specific pricing units are persisted');
contains('companyService', "['tour', 'car_rental', 'cargo'].includes(serviceType)", 'Publishing validates every new service type');
contains('workspace', /showFor\s*:\s*['\"]tour['\"]/, 'Tour form fields are service-specific');
contains('workspace', /showFor\s*:\s*['\"]car_rental['\"]/, 'Car-rental form fields are service-specific');
contains('workspace', /showFor\s*:\s*['\"]cargo['\"]/, 'Cargo form fields are service-specific');

// Canonical projection prevents Edit from opening reduced or unrelated records.
contains('projection', 'Preserve the canonical employee fields', 'Staff rows preserve canonical employee records');
contains('projection', 'detail: { driver: employee', 'Driver rows carry the canonical driver employee record');
contains('projection', 'detail: { staff: employee', 'Staff rows carry the canonical staff employee record');
contains('projection', /(?:entity|dashboardMeta\()\s*:?\s*['\"]branch['\"]/, 'Branch rows carry entity metadata');
contains('projection', /(?:entity|dashboardMeta\()\s*:?\s*['\"]policy['\"]/, 'Policy rows carry entity metadata');
contains('projection', "entity: 'schedule_rule'", 'Recurring rules carry entity metadata');
contains('projection', /(?:entity|dashboardMeta\()\s*:?\s*['\"]hotel_property['\"]/, 'Property rows carry entity metadata');
contains('projection', /(?:entity|dashboardMeta\()\s*:?\s*['\"]room_type['\"]/, 'Room-type rows carry entity metadata');
contains('projection', /(?:entity|dashboardMeta\()\s*:?\s*['\"]rate_plan['\"]/, 'Rate-plan rows carry entity metadata');
contains('projection', /(?:entity|dashboardMeta\()\s*:?\s*['\"]room_unit['\"]/, 'Room-unit rows carry entity metadata');
contains('projection', /(?:entity|dashboardMeta\()\s*:?\s*['\"]room_night['\"]/, 'Room-night rows carry entity metadata');

const failed = checks.filter((item) => !item.ok);
if (failed.length) {
  console.error(`\nVIP and partner dashboard CRUD audit failed (${checks.length - failed.length}/${checks.length}).`);
  failed.forEach((item) => console.error(`- ${item.label}: ${item.error}`));
  process.exit(1);
}
console.log(`\nVIP and partner dashboard CRUD audit passed (${checks.length}/${checks.length}).`);

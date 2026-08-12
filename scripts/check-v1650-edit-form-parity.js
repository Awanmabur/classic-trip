'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const ui = read('public/js/dashboard-workspace.js');
const bus = read('src/modules/bus/services/busSetupService.js');
const hotel = read('src/services/hotel/hotelService.js');
const pkg = require(path.join(root, 'package.json'));
let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log(`✓ ${label}`);
}
function block(start, end) {
  const a = ui.indexOf(start);
  assert(a >= 0, `Missing block start: ${start}`);
  const b = end ? ui.indexOf(end, a + start.length) : -1;
  return ui.slice(a, b > a ? b : undefined);
}
function hasField(source, name, type = '') {
  const pattern = type
    ? new RegExp(`name:['\"]${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['\"][^\\n]*type:['\"]${type}['\"]`)
    : new RegExp(`name:['\"]${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['\"]`);
  assert(pattern.test(source), `Expected field ${name}${type ? ` (${type})` : ''}`);
}
function selectableField(source, name) {
  const line = source.split('\n').find((row) => row.includes(`name:'${name}'`) || row.includes(`name:"${name}"`));
  assert(line, `Missing ${name}`);
  assert(/type:'select'|type:"select"/.test(line), `${name} must be a visible select`);
  assert(!/locked:true|locked:editing/.test(line), `${name} must remain selectable during Edit`);
}

check('release is v1.6.50 or newer', () => assert(/^1\.6\.(?:5[0-9]|[6-9][0-9])$/.test(pkg.version), `Expected v1.6.50+, got ${pkg.version}`));
check('Edit relationship selects are not globally disabled/locked', () => {
  assert(!ui.includes("if (field.locked)"));
  assert(!ui.includes('data-locked-selection'));
});
check('inactive/legacy current selections remain visible', () => assert(ui.includes('preserveCurrentSelection')));

const routeEdit = block("mode === 'edit' && key === 'route'", "mode === 'edit' && (key === 'routestop'");
check('Route Edit shows the Bus listing selected during Create', () => selectableField(routeEdit, 'listingId'));
check('Route Edit retains all main Create selections', () => ['listingId','routeName','routeCode','timezone','originBranchId','destinationBranchId','boardingBranchIds','dropoffBranchIds','distanceKm','estimatedDuration','operatingDays','baggageRules','cancellationRules'].forEach((f) => hasField(routeEdit, f)));
check('Route backend supports validated listing reassignment', () => { assert(bus.includes('const listingChanged =')); assert(bus.includes('previousListingId')); assert(bus.includes('routeSegments.updateMany')); });

const vehicleEdit = block("mode === 'edit' && key === 'vehicle'", "mode === 'edit' && key === 'schedule'");
check('Vehicle Edit shows its service listing instead of hiding listingId', () => selectableField(vehicleEdit, 'listingId'));
check('Vehicle Edit retains seat-map/compliance selections', () => ['listingId','name','plateOrCode','vehicleClass','layoutName','numberingStartSide','driverPosition','frontRowPassengerSeats','rowLayoutOverrides','rows','totalSeats','seatLabelMode','seatLabelPrefix','seatLabels','manufacturer','model','modelYear','operatorPermitRef','operatorPermitExpiresAt','inspectionRef','inspectionExpiresAt','insuranceRef','insuranceExpiresAt','status','amenities'].forEach((f) => hasField(vehicleEdit, f)));
check('Vehicle backend supports validated listing reassignment', () => { assert(bus.includes('targetListing')); assert(bus.includes('seatMapTemplates.updateMany')); assert(bus.includes('scheduleRules.updateMany')); });

const propertyEdit = block("mode === 'edit' && key === 'hotel_property'", "mode === 'edit' && key === 'room_type'");
check('Property Edit shows its Stay listing', () => selectableField(propertyEdit, 'listingId'));
const roomTypeEdit = block("mode === 'edit' && key === 'room_type'", "mode === 'edit' && key === 'rate_plan'");
check('Room Type Edit shows listing and property relationships', () => { selectableField(roomTypeEdit, 'listingId'); selectableField(roomTypeEdit, 'propertyId'); });
const ratePlanEdit = block("mode === 'edit' && key === 'rate_plan'", "mode === 'edit' && key === 'room_unit'");
check('Rate Plan Edit shows its Room Type selection', () => selectableField(ratePlanEdit, 'roomTypeId'));
const roomUnitEdit = block("mode === 'edit' && key === 'room_unit'", "mode === 'edit' && key === 'room_night'");
check('Room Unit Edit shows its Room Type selection', () => selectableField(roomUnitEdit, 'roomTypeId'));
const roomNightEdit = block("mode === 'edit' && key === 'room_night'", "if (isCompanyRole && key === 'route stop'");
check('Room-night Edit shows room type, room unit, rate plan and date context', () => {
  selectableField(roomNightEdit, 'roomTypeId');
  selectableField(roomNightEdit, 'roomUnitId');
  selectableField(roomNightEdit, 'ratePlanId');
  hasField(roomNightEdit, 'date', 'date');
});
check('Hotel update services persist validated relationship changes', () => {
  assert(hotel.includes('hotel_property_listing_change_committed'));
  assert(hotel.includes('hotel_room_type_parent_change_committed'));
  assert(hotel.includes('hotel_room_unit_parent_change_committed'));
  assert(hotel.includes('hotel_rate_plan_parent_change_committed'));
  assert(hotel.includes('hotel_inventory_relationship_committed'));
});

const fare = block("key === 'fare product' || key === 'fare_product'", "key === 'segment fare' || key === 'segment_fare'");
check('Fare Plan Edit keeps Route visible', () => {
  hasField(fare, 'routeId', 'select');
  assert(!fare.includes('locked:editing'));
  assert(bus.includes('routeChanged'));
  assert(bus.includes('Fare plan moved to another route'));
});

const scheduleEdit = block("mode === 'edit' && key === 'schedule'", "mode === 'edit' && key === 'room'");
check('Departure Edit keeps route, vehicle and fare selections visible', () => ['routeId','vehicleId','fareProductId','driverId'].forEach((f) => hasField(scheduleEdit, f, 'select')));
const staffEdit = block("mode === 'edit' && key === 'staff status'", "mode === 'edit' && (key === 'driver profile'");
check('Staff Edit keeps branch, listing, schedule and permissions selections visible', () => ['branchId','listingIds','scheduleIds','permissions'].forEach((f) => hasField(staffEdit, f)));
const driverEdit = block("mode === 'edit' && (key === 'driver profile'", "if (isCompanyRole && key === 'branch'");
check('Driver Edit keeps branch, listing, schedule, permissions and vehicle selections visible', () => ['branchId','listingIds','scheduleIds','permissions','vehicleId'].forEach((f) => hasField(driverEdit, f)));


const seatTemplate = block("key === 'vehicle seat template'", "if (isCompanyRole && (key === 'booking' || key === 'offline sale'))");
check('Seat Template Edit shows the selected Vehicle instead of hiding vehicleId', () => {
  const line = seatTemplate.split('\n').find((row) => row.includes("name:'vehicleId'"));
  assert(line && line.includes("type:'select'") && !line.includes('locked:true'));
  assert(seatTemplate.includes("action: '/company/vehicles/seat-template'"));
});

check('no Route/Vehicle Edit listing relationship is hidden anymore', () => {
  assert(!/mode === 'edit' && key === 'route'[\s\S]{0,1400}name:'listingId', type:'hidden'/.test(ui));
  assert(!/mode === 'edit' && key === 'vehicle'[\s\S]{0,1000}name:'listingId', type:'hidden'/.test(ui));
});

console.log(`\n${passed}/21 v1.6.50+ selectable edit-form parity checks passed.`);

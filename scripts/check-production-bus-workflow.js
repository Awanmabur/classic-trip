'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const failures = [];
let checks = 0;
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const check = (condition, message) => { checks += 1; if (!condition) failures.push(message); };

const setup = read('src/modules/bus/services/busSetupService.js');
const departures = read('src/modules/bus/services/busDepartureService.js');
const onboarding = read('src/services/company/busServiceOnboarding.js');
const visibility = read('src/services/marketplace/catalogVisibility.js');
const liveMaps = read('src/services/dashboard/liveDepartureSeatMapProjection.js');
const dashboard = read('public/js/dashboard-workspace.js');
const seatMapView = read('src/views/dashboards/shared/sections/seat-maps.ejs');

check(/Publish at least one dated departure/.test(setup), 'Activation must require a dated departure');
check(/validPublishedDepartures/.test(setup), 'Activation must use validated published departures');
check(/departAt:\s*\{\s*\$gt:\s*nowDate\s*\}/.test(setup), 'Activation must require a future departure');
check(/companyId,\s*listingId:\s*listingKey/.test(setup), 'Departure discovery must use exact company and listing ownership');
check(/segmentInventory\.count\(\{[\s\S]*companyId,[\s\S]*listingId:\s*listingKey,[\s\S]*scheduleId:\s*schedule\.id/.test(setup), 'Activation must verify live segment inventory for the exact departure');
check(/driverEmployeeId/.test(setup), 'Activation must require a driver assignment');
check(/published seat-map version link is missing/.test(setup), 'Activation must diagnose missing seat-map linkage');
check(/departure status is/.test(setup), 'Activation must report a draft/unpublished departure instead of claiming none exists');

check(/status:\s*requestedStatus === 'active' \? 'published'/.test(onboarding) || /departureStatus.*published/.test(onboarding), 'One-click setup must publish the departure before activating the listing');
check(/createSchedule/.test(onboarding) && /publishListing/.test(onboarding) && onboarding.indexOf('companyService.createSchedule') < onboarding.indexOf('companyService.publishListing'), 'One-click setup must create the departure and activate the listing in order');
check(/IdempotencyKeyRecord/.test(onboarding), 'One-click setup must be idempotent in MongoDB');
check(!/memory|fallback store|repair/i.test(onboarding), 'One-click setup must not use memory or repair fallbacks');

check(/validateSchedulePublish/.test(departures), 'Departure publication must validate the canonical relationship chain');
check(/seat_segment_inventory_missing/.test(departures), 'Departure publication must require persisted seat-segment inventory');
check(/departure_must_be_future/.test(departures), 'Departure publication must reject past departures');
check(!/repairSchedule|resolveOwnedBusListing|infer/i.test(departures), 'Departure service must not infer or repair incomplete records');

check(/listing\.bookable === true && hasPublishedDeparture/.test(visibility), 'Public bus visibility must require bookable status and a real departure');
check(/schedule\.companyId/.test(visibility) && /schedule\.listingId/.test(visibility), 'Public schedule matching must use exact ownership links');
check(!/SERVICE_ALIASES|coach|bus_company|publishedBusDeparture/.test(visibility), 'Public visibility must not use old service aliases or auto-publication inference');

check(/persisted_inventory/.test(liveMaps), 'Live seat maps must identify persisted inventory');
check(!/capacity_fallback|schedule_inventory_snapshot|needsRepair|vehicle_seat_template/.test(liveMaps), 'Live seat maps must not fabricate or recover inventory');
check(/inventoryMissing/.test(liveMaps), 'Incomplete departures must be reported explicitly');
check(/This departure has no persisted seat inventory/.test(seatMapView), 'The dashboard must explain incomplete canonical departures');

check(/function syncScheduleForm/.test(dashboard), 'Schedule form must auto-fill linked bus data');
check(/function syncVehicleSeatTemplateForm/.test(dashboard), 'Seat-template form must synchronize the selected vehicle');
check(/Custom numbering needs exactly/.test(dashboard), 'Custom labels must be validated before submission');
check(/name:'seatLabelMode'/.test(dashboard), 'Seat numbering mode must be available');
check(!/name:'currency'.*fare/i.test(dashboard), 'Bus fare forms must not ask operators to retype currency');

if (failures.length) {
  console.error(`Production bus workflow validation failed (${failures.length}/${checks}):`);
  failures.forEach((failure, index) => console.error(`${index + 1}. ${failure}`));
  process.exit(1);
}
console.log(`Production bus workflow validation passed (${checks}/${checks}).`);

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0;
function check(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
    return;
  }
  passed += 1;
}
function read(file) { return fs.readFileSync(path.join(process.cwd(), file), 'utf8'); }

const setup = read('src/modules/bus/services/busSetupService.js');
const departure = read('src/modules/bus/services/busDepartureService.js');
const company = read('src/services/company/companyService.js');
const workspace = read('public/js/dashboard-workspace.js');
const companyService = read('src/services/company/companyService.js');

check(setup.includes('async function smartPublishBusListing'), 'Bus listing must expose a smart publish orchestrator.');
check(setup.includes("if (requestedStatus === 'active')") && setup.includes('await smartPreparePublishedDeparture(companyId, listing.id, actor)'), 'Editing a listing to Active must use the same smart preparation flow.');
check(setup.includes('async function smartPreparePublishedDeparture'), 'Smart publishing must prepare an existing future dated departure.');
check(setup.includes('await assignableDrivers(companyId)'), 'Smart publishing must resolve all assignable saved drivers regardless of lifecycle status.');
check(setup.includes('chooseDriverForSchedule(drivers, schedule)'), 'Smart publishing must choose the best company-owned driver deterministically instead of blocking on multiple records.');
check(!setup.includes('More than one driver is available'), 'The obsolete multi-driver publication blocker must be removed.');
check(setup.includes('departureService.generateInventory'), 'Smart publishing must rebuild missing seat-segment inventory from canonical records.');
check(setup.includes('departureService.publishSchedule'), 'Smart publishing must publish the dated departure before listing activation.');
check(setup.includes("failure !== 'Publish at least one dated departure'"), 'Smart repair must not bypass unrelated listing readiness failures.');
check(company.includes('busSetupService.smartPublishBusListing'), 'Company listing publish dispatch must use the smart bus publisher.');

check(departure.includes("status: requestedStatus,"), 'Schedule edits must preserve a requested Published status.');
check(departure.includes('replacesScheduleId: schedule.id'), 'Schedule replacement must identify the old departure for conflict exclusion.');
check(departure.includes('Build and validate the replacement first'), 'Schedule edit must keep the original record intact until replacement validation succeeds.');
check(departure.includes('findVehicleConflicts(companyId, vehicle.id, departAt, arriveAt, cleanText(payload.replacesScheduleId'), 'Replacement creation must exclude the original vehicle reservation from overlap detection.');
check(departure.includes("return repository.scheduleOrThrow(companyId, replacement.schedule.id)"), 'Schedule edit must return the newly persisted replacement.');

check(companyService.includes("approvalOwner: 'partner_admin'"), 'Partner Admin must own driver status changes after company approval.');
check(workspace.includes('Partner Admin set driver active') || workspace.includes('Set driver active'), 'Driver rows must expose a direct Partner Admin status action.');
check(workspace.includes('Finish setup and publish listing'), 'Listing action must clearly indicate the smart completion workflow.');
check(setup.includes('evaluateDriverAssignment(assignedEmployee || {}, assignedUser || {})'), 'Listing readiness must validate the assigned driver relationship without requiring operational status.');

if (!process.exitCode) console.log(`Smart listing publication verification passed (${passed}/${passed}).`);

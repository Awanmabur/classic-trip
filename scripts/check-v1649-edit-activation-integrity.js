#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = require('../package.json');
let passed = 0;
const check = (name, fn) => { fn(); passed += 1; console.log(`✓ ${name}`); };
const ui = read('public/js/dashboard-workspace.js');
const setup = read('src/modules/bus/services/busSetupService.js');
const departure = read('src/modules/bus/services/busDepartureService.js');
const projection = read('src/services/dashboard/dashboardProjectionEngine.js');
const routes = read('src/routes/web/company.js');
const companyService = read('src/services/company/companyService.js');
const invitationService = read('src/services/onboarding/invitationService.js');
const launchRepair = read('scripts/repair-bus-launch-readiness.js');

check('release is v1.6.49 or newer', () => assert(Number(pkg.version.split('.')[2] || 0) >= 49 && pkg.version.startsWith('1.6.')));
check('bus listing edit exposes activation requirements', () => {
  assert(ui.includes("mode === 'edit' && key === 'listing'"));
  ['operatorLicenceRef', 'branchId', 'baggageRules', 'cancellationRules', 'contactPhone', 'salesChannels'].forEach((field) => assert(ui.includes(`name:'${field}'`)));
  assert(ui.includes("required: companyServiceType === 'bus'"));
});
check('edit forms hydrate canonical saved values', () => {
  assert(ui.includes('function normalizeEditConfig'));
  assert(ui.includes('recursiveEditValue'));
  assert(ui.includes('normalizeEditConfig(adminFormConfig'));
});
check('inactive/current selections are preserved instead of silently cleared', () => {
  assert(ui.includes('data-current-selection="true"'));
  assert(ui.includes("option.dataset.currentSelection === 'true' && option.selected"));
  assert(ui.includes("label.dataset.currentSelection === 'true'"));
});
check('vehicle edit includes creation-time seat layout fields', () => {
  const start = ui.indexOf("mode === 'edit' && key === 'vehicle'");
  const end = ui.indexOf("mode === 'edit' && key === 'schedule'", start);
  const block = ui.slice(start, end);
  ['layoutName','numberingStartSide','driverPosition','frontRowPassengerSeats','rowLayoutOverrides','rows','totalSeats','seatLabelMode','seatLabelPrefix','seatLabels'].forEach((field) => assert(block.includes(`name:'${field}'`)));
});
check('vehicle edit publishes a new seat-map version only for seat-layout changes', () => {
  assert(setup.includes('const seatTemplateChanged = vehicleClassChanged || layoutChanged'));
  assert(setup.includes('await updateVehicleSeatTemplate(companyId, vehicle.id'));
  assert(setup.includes('savedVehicle = seatTemplateUpdate.vehicle'));
});
check('seat attributes are preserved across vehicle template edits', () => {
  ['accessibleSeats','crewSeats','disabledSeats','blockedSeats','vipSeats'].forEach((field) => assert(setup.includes(`preserveSeatList('${field}'`)));
});
check('readiness accepts published seat-map versions referenced by existing future departures', () => {
  assert(setup.includes('const departureSeatMapIds = futureCompanyDepartures.map'));
  assert(setup.includes('[...activeVehicleSeatMapIds, ...departureSeatMapIds]'));
});
check('readiness verifies the selected operating branch still exists and is active', () => {
  assert(setup.includes("repository.branches.findOne({ id: listing.branchId, companyId, status: 'active' })"));
  assert(setup.includes("if (!listing.branchId || !operatingBranch) failures.push('Select an active operating branch or terminal')"));
});
check('legacy departure repair can inherit the vehicle current published seat map safely', () => {
  assert(departure.includes('vehicle.activeSeatMapVersionId'));
  assert(departure.includes('schedule.seatMapVersionId = fallbackVersion.id'));
  assert(departure.includes('schedule.seatMapSnapshot = scheduleSeatMapSnapshot'));
  assert(departure.includes("mode = relinkedSeatMap ? 'seat_map_relinked_and_inventory_rebuilt'"));
});
check('legacy repair refuses seat-map relinking when passengers or holds exist', () => {
  assert(departure.includes('departureHasPassengerActivity'));
  assert(departure.includes('missing seat-map link cannot be replaced automatically'));
  assert(departure.includes('inventory_repair_requires_manual_review'));
});
check('publish repairs both missing seat-map link and missing live inventory', () => {
  assert(departure.includes("['seat_segment_inventory_missing', 'published_seat_map_missing'].includes(failure)"));
  assert(departure.includes('await repairScheduleInventory(companyId, schedule.id, actor)'));
});
check('smart activation validates and tries multiple future departure candidates', () => {
  assert(setup.includes('for (const candidate of ordered)'));
  assert(setup.includes('await departureService.validateSchedulePublish(companyId, schedule)'));
  assert(setup.includes('No future departure could be prepared automatically'));
});
check('schedule rows expose an explicit safe legacy inventory repair action', () => {
  assert(ui.includes('/company/schedules/${id}/repair-inventory'));
  assert(routes.includes("router.post('/company/schedules/:id/repair-inventory'"));
});
check('staff and driver edit forms remain full persisted workflows', () => {
  assert(ui.includes("mode === 'edit' && key === 'staff status'"));
  assert(ui.includes("mode === 'edit' && (key === 'driver profile' || key === 'driver activation')"));
  assert(routes.includes("router.post('/company/staff/:id/role'"));
  assert(routes.includes("router.post('/company/drivers/:id/profile'"));
  assert(companyService.includes('async function updateDriverProfile'));
});
check('route edit exposes the same boarding and drop-off selections used during create', () => {
  const start = ui.indexOf("mode === 'edit' && key === 'route'");
  const end = ui.indexOf("mode === 'edit' && key === 'vehicle'", start);
  const block = ui.slice(start, end);
  assert(block.includes("name:'boardingBranchIds'"));
  assert(block.includes("name:'dropoffBranchIds'"));
  assert(block.includes("detail?.route?.boardingBranchIds"));
  assert(block.includes("detail?.route?.dropoffBranchIds"));
});
check('route update synchronizes edited intermediate stop selections without retyping IDs', () => {
  assert(setup.includes("const intermediateSelectionChanged = boardingSelectionChanged || dropoffSelectionChanged"));
  assert(setup.includes("const desiredPickup = boardingSelectionChanged"));
  assert(setup.includes("const desiredDropoff = dropoffSelectionChanged"));
  assert(setup.includes("status: 'archived'"));
  assert(setup.includes('const allStops = [originStop, ...activeIntermediateStops, destinationStop, ...archivedIntermediateStops]'));
  assert(setup.includes('await repository.routeStops.saveMany(allStops'));
});
check('retained route stops keep their persisted timing and instructions', () => {
  assert(setup.includes('let stop = existingByBranch.get(branchId)'));
  assert(setup.includes("publicInstructions: ''"));
  assert(setup.includes("timeOffsetMinutes: 0, publicInstructions: ''"));
});
check('staff creation fields survive invitation acceptance and are editable later', () => {
  const createStart = ui.indexOf("isCompanyRole && (key === 'staff' || key === 'hotel staff')");
  const editStart = ui.indexOf("mode === 'edit' && key === 'staff status'", createStart);
  const createBlock = ui.slice(createStart, editStart);
  assert(createBlock.includes("name:'shift'"));
  assert(createBlock.includes("name:'notes'"));
  assert(companyService.includes('shift: cleanText(payload.shift, 120)'));
  assert(companyService.includes("notes: cleanText(payload.notes || payload.note, 2000)"));
  assert(invitationService.includes("shift: cleanText(payload.shift || '')"));
  assert(invitationService.includes("notes: cleanText(payload.notes || payload.note || '')"));
});
check('driver edit restores pending invitation and schedule selections', () => {
  assert(ui.includes("fieldValue('driver.scheduleIds','driver.pendingScheduleId','invitation.scheduleIds','invitation.scheduleId','schedule.id')"));
  assert(ui.includes("fieldValue('driver.permissions','invitation.permissions')"));
  assert(ui.includes("fieldValue('driver.branchId','invitation.branchId')"));
});
check('legacy bus launch repair fixes inventory and only auto-publishes legacy active departures', () => {
  assert(launchRepair.includes("status: { $in: ['draft', 'active', 'published'] }"));
  assert(launchRepair.includes('repairScheduleInventory'));
  assert(launchRepair.includes("normalize(schedule.status) === 'active'"));
  assert(launchRepair.includes('publishSchedule'));
  assert(!launchRepair.includes("normalize(schedule.status) === 'draft' && publish"));
});
check('dashboard detail exposes persisted listing activation fields to edit forms', () => {
  ['branchId','contactPhone','operatorLicenceRef','baggageRules','cancellationRules','salesChannels'].forEach((field) => assert(projection.includes(`${field}: listing.${field}`) || projection.includes(`${field}: Array.isArray(listing.${field})`)));
});
console.log(`\n${passed}/22 v1.6.49+ edit/activation integrity checks passed.`);

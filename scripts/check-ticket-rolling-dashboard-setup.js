#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const failures = [];
let passed = 0;

function check(name, condition) {
  if (condition) passed += 1;
  else failures.push(name);
}

const details = read('src/views/pages/listing-details.ejs');
const detailsCss = read('public/css/completion-fixes.css');
const searchService = read('src/modules/bus/services/busSearchService.js');
const inventoryService = read('src/modules/bus/services/busInventoryService.js');
const departureService = read('src/modules/bus/services/busDepartureService.js');
const scheduleController = read('src/controllers/company/scheduleController.js');
const dashboardJs = read('public/js/dashboard-workspace.js');
const dashboardView = read('src/views/dashboards/shared/workspace.ejs') + read('src/views/dashboards/shared/sections/overview-quick-actions.ejs');
const materializer = read('src/jobs/materializeSchedules.js');
const tripSchedule = read('src/models/TripSchedule.js');

check('Standard and VIP tickets are separate side-by-side choices',
  details.includes('Standard Ticket')
  && details.includes('VIP Ticket')
  && details.includes('data-ticket-class="standard"')
  && details.includes('data-ticket-class="vip"')
  && detailsCss.includes('.listingPreviewPage .ticketChoiceGrid{display:grid;grid-template-columns:repeat(2'));
check('Return Ticket is always a first-class journey choice',
  details.includes('id="returnTicketChoice"')
  && details.includes('<b>Return Ticket</b>')
  && details.includes('setTripType'));
check('Return search remains visible when no reverse trip exists',
  details.includes('No future reverse departure is currently published for this journey.')
  && details.includes('No future reverse trips available')
  && details.includes('returnTime > outboundDepartureTime'));
check('Ticket class is persisted and returned through every dated-departure API layer',
  tripSchedule.includes("vehicleClass: { type: String, enum: ['standard', 'vip']")
  && departureService.includes('vehicleClass: normalize(vehicle.vehicleClass || seatMapVersion.vehicleClass)')
  && inventoryService.includes('vehicleClass: normalize(context.schedule.vehicleClass || context.seatMapVersion.vehicleClass)')
  && searchService.includes('vehicleClass: scheduleVehicleClass(schedule)'));
check('Generated schedule dates are protected from concurrent duplication',
  tripSchedule.includes('{ scheduleRuleId: 1, departAt: 1 }')
  && tripSchedule.includes('unique: true'));
check('Normal departure creation defaults to a rolling rule',
  scheduleController.includes("req.body?.departureMode || 'rolling_30_days'")
  && scheduleController.includes('createScheduleRule')
  && scheduleController.includes('one new far-end day is added automatically each day'));
check('Departure form clearly defaults to rolling 30-day coverage',
  dashboardJs.includes("name:'departureMode'")
  && dashboardJs.includes("value:'rolling_30_days'")
  && dashboardJs.includes('Rolling 30 days — automatically extend every day'));
check('Materializer preserves exactly a 30-day moving window',
  materializer.includes('const ROLLING_WINDOW_DAYS = 30')
  && materializer.includes('const HORIZON_DAYS = ROLLING_WINDOW_DAYS - 1'));
check('Materialization watermark can only move forward',
  departureService.includes('$max: { materializedThrough }'));
check('Bus setup exposes the required terminal before the guided wizard',
  dashboardView.indexOf('Add terminal first') >= 0
  && dashboardView.indexOf('Add terminal first') < dashboardView.indexOf('Create bus service'));
check('Hotel setup exposes the required listing before property setup',
  dashboardView.indexOf('Create stay listing first') >= 0
  && dashboardView.indexOf('Create stay listing first') < dashboardView.indexOf('<strong>Add property</strong>'));
check('Other company verticals receive company actions instead of super-admin actions',
  dashboardView.includes('else if(isCompanyDashboard)')
  && dashboardView.includes('<strong>Create service listing</strong>'));

if (failures.length) {
  console.error(`Ticket, rolling departure and dashboard setup audit failed (${passed}/${passed + failures.length}).`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Ticket, rolling departure and dashboard setup audit passed (${passed}/${passed}).`);

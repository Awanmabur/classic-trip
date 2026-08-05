#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { buildDashboardShell } = require('../src/services/dashboard/shellConfig');

const root = path.resolve(__dirname, '..');
const workspaceView = path.join(root, 'src/views/dashboards/shared/workspace.ejs');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const money = (amount, currency = 'UGX') => `${currency} ${Number(amount || 0).toLocaleString('en-GB')}`;
const toScriptJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
const visiblePages = [
  'overview','company-profile','staff','listings','bookings','support','reviews','ads','revenue','settlement','payouts','reports',
  'branches','routes','vehicles','schedules','seat-maps','manifests','checkins','hotel-rooms','flight-search','flight-quotes',
  'flight-travelers','flight-tickets','flight-changes','flight-refunds','taxi-fleet','taxi-drivers','taxi-availability','taxi-operations','taxi-incidents',
];
const emptyKeys = [
  'overviewStats','liveActivity','recentBookings','bookings','partners','listings','routes','vehicles','schedules','payments','promoters','customers','support','ads','routeInventory','stayInventory','reviewInventory','audit','financeAudit','securityAudit','admins','kyc','refunds','notifications','branches','policies','staff','drivers','inventory','hotelProperties','roomTypes','roomUnits','roomNightInventory','bookedSeatGroups','hotelArrivals','hotelDepartures','hotelInHouse','checkins','reviews','handovers','payouts','saved','receipts','wallet','security','passengers','links','share','commissions','withdrawals','campaigns','fraud','offlineSales','agentSales','fraudSignals','referralClicks','attributionSessions','campaignConversions','referralCards','driverOps','driverIncidents','tripStatusUpdates','seatMaps','vehicleSeatTemplates','seatMapTemplates','seatMapVersions','correspondence','deliveryAttempts','timeline','reschedules','reports','scheduleRules','fareProducts','segmentFares','routeStops','ratePlans','serviceAddons','roomVisualMaps','hotelHousekeepingTasks','hotelManifestAll','flightQuotes','flightOrders','flightTickets','flightChangeRequests','flightRefundRequests','taxiVehicles','taxiDrivers','taxiRides','taxiIncidents','taxiEarnings','vehicleClasses','priceRules','blogs','archiveRows'
];

function serviceProfile(serviceType) {
  return {
    primaryServiceType: serviceType,
    primaryLabel: serviceType === 'hotel' ? 'Stays' : serviceType === 'local_transport' ? 'Local mobility' : serviceType.replace('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
    dashboardLabel: `${serviceType.replace('_', ' ')} partner dashboard`,
    supportsBus: serviceType === 'bus',
    supportsBusOperations: serviceType === 'bus',
    supportsHotel: serviceType === 'hotel',
    supportsFlight: serviceType === 'flight',
    supportsTaxi: serviceType === 'local_transport',
    visiblePages,
  };
}

function dashboardData(profile = {}) {
  const value = Object.fromEntries(emptyKeys.map((key) => [key, []]));
  return Object.assign(value, {
    serviceProfile: profile,
    company: { id:'company-1', name:'Experience Test Company', country:'Uganda', operatingCurrency:'UGX' },
    profile: { fullName:'Experience Test User', status:'active', shift:'Current shift', permissions:[] },
    stats: {},
    options: {
      listings:[], busListings:[], hotelListings:[], branches:[], routes:[], vehicles:[], fareProducts:[], schedules:[],
      hotelProperties:[], roomTypes:[], ratePlans:[], roomUnits:[], roomNights:[], seats:[], serviceAddons:[], staff:[], drivers:[],
    },
    dashboardFeatures: { services:[], roles:{} },
  });
}

async function renderRole(role, { serviceType = '', options = null } = {}) {
  const profile = serviceType ? serviceProfile(serviceType) : {};
  const data = dashboardData(profile);
  if (options) Object.assign(data.options, options);
  const roleName = {
    admin:'super_admin', company:'company_admin', employee:'company_employee', driver:'driver', customer:'customer', promoter:'promoter',
    support:'support_admin', finance:'finance_admin', operations:'operations_admin', content:'content_admin',
  }[role];
  const user = { id:`${role}-1`, fullName:`${role} test user`, email:`${role}@example.test`, role:roleName, companyId: serviceType ? 'company-1' : '' };
  const shell = buildDashboardShell(role, {
    user,
    companyId:user.companyId,
    company:data.company,
    companies: serviceType ? [data.company] : [],
    serviceProfile:profile,
    permissions:['booking.view','booking.create_manual','checkin.manage','inventory.update','support.manage','handover.create','reports.view','profile.update'],
  });
  return ejs.renderFile(workspaceView, {
    seo:{ title:`${role} dashboard test` },
    dashboardData:data,
    dashboardShell:shell,
    csrfToken:'experience-csrf',
    cspNonce:'experience-csp',
    flashMessages:[],
    platformConfig:{ defaultCurrency:'UGX', supportedCurrencies:['UGX','KES','USD'], partnerCommissionPercent:10, partnerPayoutPercent:90, promoterSharePercent:10, customerServiceFeePercent:5, customerServiceFeeFlat:0, customerTaxPercent:0, holdMinutes:15, supportMessage:'' },
    countryMarkets:[],
    platformMfaEnabled:false,
    currentUser:user,
    toScriptJson,
    money,
  });
}

function count(source, token) { return source.split(token).length - 1; }

(async () => {
  const roleExpectations = {
    admin:'data-type="partner"',
    customer:'href="/search"',
    promoter:'data-type="promoter link"',
    support:'href="/support/dashboard/support"',
    finance:'href="/finance/dashboard/payments"',
    operations:'data-type="booking"',
    content:'href="/content/dashboard/blogs"',
    employee:'data-type="booking"',
    driver:'data-type="driver trip update"',
  };
  for (const [role, marker] of Object.entries(roleExpectations)) {
    const html = await renderRole(role, role === 'driver' || role === 'employee' ? { serviceType:'bus' } : {});
    assert(html.includes('<!DOCTYPE html>'), `${role} dashboard did not render a complete document`);
    assert(html.includes(marker), `${role} dashboard top action is not role-correct`);
    assert.strictEqual(count(html, 'id="btnNew"'), 1, `${role} dashboard rendered more than one primary create action`);
    assert(html.includes('aria-modal="true"') && html.includes('aria-hidden="true"'), `${role} dashboard dialogs are missing accessibility state`);
    if (role !== 'admin') {
      assert(!html.includes('id="admins"') && !html.includes('id="settings"'), `${role} dashboard leaked admin-only sections`);
      assert(!html.includes('action="/admin/admin-users"'), `${role} dashboard leaked an admin mutation form`);
    }
    if (role === 'driver') assert(!html.includes('action="/admin/notices"'), 'Driver dashboard leaked the platform broadcast form');
  }

  for (const serviceType of ['bus','hotel','flight','local_transport','tour','car_rental','cargo']) {
    const html = await renderRole('company', { serviceType });
    assert(html.includes('Partner Company Console'), `${serviceType} company shell did not render`);
    if (serviceType === 'flight') assert(html.includes('href="/company/dashboard/flight-search"'), 'Flight top action must open live flight search');
    if (serviceType === 'local_transport') assert(html.includes('href="/company/dashboard/taxi-fleet"'), 'Mobility top action must open owned fleet setup');
  }

  const busFirst = await renderRole('company', { serviceType:'bus' });
  assert(busFirst.includes('data-type="branch"') && busFirst.includes('Add Terminal'), 'New bus partners must start with two scoped terminals');
  const busWizard = await renderRole('company', { serviceType:'bus', options:{ branches:[{id:'a'},{id:'b'}] } });
  assert(busWizard.includes('data-type="bus service"') && busWizard.includes('Set Up Bus Service'), 'Bus setup must progress to the connected service wizard');
  const busRolling = await renderRole('company', { serviceType:'bus', options:{ branches:[{id:'a'},{id:'b'}], busListings:[{id:'l'}], routes:[{id:'r'}], vehicles:[{id:'v'}], fareProducts:[{id:'f'}] } });
  assert(busRolling.includes('data-type="schedule"') && busRolling.includes('Create 30-Day Departures'), 'Completed bus setup must default to rolling departures');

  const hotelStages = [
    [{}, 'data-type="listing"', 'Create Stay Listing'],
    [{ hotelListings:[{id:'l'}] }, 'data-type="hotel property"', 'Add Property'],
    [{ hotelListings:[{id:'l'}], hotelProperties:[{id:'p'}] }, 'data-type="room type"', 'Add Room Type'],
    [{ hotelListings:[{id:'l'}], hotelProperties:[{id:'p'}], roomTypes:[{id:'t'}] }, 'data-type="room units"', 'Add Rooms'],
    [{ hotelListings:[{id:'l'}], hotelProperties:[{id:'p'}], roomTypes:[{id:'t'}], roomUnits:[{id:'u'}] }, 'data-type="room night inventory"', 'Open Room Inventory'],
  ];
  for (const [options, marker, label] of hotelStages) {
    const html = await renderRole('company', { serviceType:'hotel', options });
    assert(html.includes(marker) && html.includes(label), `Stay setup stage ${label} is not reachable`);
  }

  const workspace = read('public/js/dashboard-workspace.js');
  const services = read('src/views/pages/services.ejs');
  const driverRoutes = read('src/routes/web/employee.js');
  const driverService = read('src/services/company/companyService.js');
  const accessibility = read('public/css/accessibility-safe.css');
  const stayDetails = read('src/views/pages/listing-details.ejs');
  const hotelRooms = read('src/views/dashboards/shared/sections/hotel-rooms.ejs');
  const catalog = read('src/services/marketplace/catalogService.js');
  const listingController = read('src/controllers/public/listingController.js');
  const listingApi = read('src/routes/api/listings.js');
  assert(workspace.includes("action: '/promoter/links'") && workspace.includes("key === 'promoter link'"), 'Promoter create-link modal is incomplete');
  assert(workspace.includes("action: '/driver/trips/status'") && workspace.includes("action: '/driver/incidents'"), 'Driver create actions are incomplete');
  assert(!workspace.includes('defaultCreateModalType'), 'A duplicate hard-coded create handler can invoke the wrong workflow');
  assert(!workspace.includes('if (!hasSelectableDriver && !driver.value)'), 'Missing optional driver must not silently force a schedule to draft');
  assert(driverRoutes.includes("router.post('/driver/trips/status'") && driverRoutes.includes("router.post('/driver/profile'") && driverRoutes.includes("router.post('/driver/handovers'"), 'Driver mutation routes are incomplete');
  assert(driverService.includes("permittedDriverStatuses") && driverService.includes("Number.isFinite(parsed)"), 'Driver updates require bounded status and count validation');
  assert(!services.includes('remain on the future roadmap'), 'Live service categories are still described as future roadmap items');
  assert(accessibility.includes('outline: 2px solid var(--ct-focus-outline) !important'), 'Form controls do not expose a visible keyboard focus indicator');
  assert(stayDetails.includes('stayOptionGrid') && stayDetails.includes('stayOptionCard'), 'Public stay inventory still uses a vehicle-seat layout');
  assert(hotelRooms.includes('roomUnitGrid') && hotelRooms.includes('roomUnitCard'), 'Partner room layout still uses the old seat-tile design');
  assert(stayDetails.includes('room.availableUnits ?? room.inventory ?? 0'), 'Sold-out dated room inventory can incorrectly fall back to total physical inventory');
  assert(catalog.includes("normalize(unit.status) === 'available'") && catalog.includes("['clean', 'inspected', 'ready']"), 'Stay previews count rooms that are unavailable or not housekeeping-ready');
  assert(listingController.includes('hotelInventoryService.availabilityForRange(listing.id, checkIn, checkOut)'), 'Stay details do not use authoritative date-range inventory');
  assert(listingApi.includes('availableUnits: Number(room.availableUnits ?? room.inventory ?? 0)'), 'Stay availability API does not preserve an explicit zero inventory value');

  console.log('Platform experience final checks passed (roles, services, setup stages, mutations, accessibility and stay layouts).');
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

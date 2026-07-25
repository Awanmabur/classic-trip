'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const failures = [];
const checks = [];

function expect(name, condition) {
  checks.push(name);
  if (!condition) failures.push(name);
}

function compileTemplate(template, filename) {
  let cursor = 0;
  let generated = 'let __output = "";\n';
  const opener = /<%([_\-=#]?)/g;
  let match;
  while ((match = opener.exec(template)) !== null) {
    const text = template.slice(cursor, match.index);
    if (text) generated += `__output += ${JSON.stringify(text)};\n`;
    const marker = match[1];
    const closeIndex = template.indexOf('%>', opener.lastIndex);
    if (closeIndex === -1) throw new SyntaxError(`${filename}: unclosed EJS tag`);
    let body = template.slice(opener.lastIndex, closeIndex);
    if (body.endsWith('-')) body = body.slice(0, -1);
    if (marker === '=' || marker === '-') generated += `__output += String(((${body}) ?? ""));\n`;
    else if (marker !== '#') generated += `${body}\n;\n`;
    cursor = closeIndex + 2;
    opener.lastIndex = cursor;
  }
  const tail = template.slice(cursor);
  if (tail) generated += `__output += ${JSON.stringify(tail)};\n`;
  generated += 'return __output;';
  // eslint-disable-next-line no-new-func
  return new Function('locals', `with (locals || {}) { ${generated} }`);
}

const menus = read('src/config/dashboardMenus.js');
const features = read('src/config/dashboardFeatures.js');
const shell = read('src/services/dashboard/shellConfig.js');
const projection = read('src/services/dashboard/dashboardProjectionEngine.js');
const workspace = read('src/views/dashboards/shared/workspace.ejs');
const partners = read('src/views/dashboards/shared/sections/partners.ejs');
const partnerNetwork = read('src/views/dashboards/shared/sections/admin-partner-network.ejs');
const workspaceJs = read('public/js/dashboard-workspace.js');
const taxiSetup = read('src/modules/taxi/services/taxiSetupService.js');
const taxiRoutes = read('src/modules/taxi/routes/adminTaxiRoutes.js');

['Bus Providers', 'Hotel Providers', 'Flight Agents & Supply', 'Local Mobility'].forEach((label) => {
  expect(`Super Admin service menu includes ${label}`, menus.includes(label));
});

[
  'Flight Agents', 'Boda Riders', 'Car Drivers', 'Fleet & Rental Owners', 'Mobility Companies',
  'Driver Verification', 'Vehicle Compliance', 'Dispatch & Live Rides', 'Safety & Incidents',
].forEach((label) => expect(`Super Admin partner network includes ${label}`, menus.includes(label)));

['bus-dashboard', 'hotel-dashboard', 'flight-dashboard', 'taxi-dashboard'].forEach((key) => {
  expect(`Production service dashboard exists: ${key}`, features.includes(`key: '${key}'`) && features.includes("status: 'production'"));
});

[
  'partnersTable', 'partnersBusTable', 'partnersHotelTable', 'partnersFlightTable', 'partnersBodaTable',
  'partnersCarTable', 'partnersFleetTable', 'partnersMobilityCompanyTable', 'partnersPendingTable',
].forEach((id) => expect(`Partners directory contains ${id}`, partners.includes(id)));

[
  '#partnersTable', '#partnersBusTable', '#partnersHotelTable', '#partnersFlightTable', '#partnersBodaTable',
  '#partnersCarTable', '#partnersFleetTable', '#partnersMobilityCompanyTable', '#partnersPendingTable',
].forEach((selector) => expect(`Dashboard hydrates ${selector}`, workspaceJs.includes(selector)));

expect('Admin workspace includes complete partner-network sections', workspace.includes("include('sections/admin-partner-network'"));
[
  'flight-agents', 'boda-riders', 'car-drivers', 'fleet-owners', 'mobility-companies',
  'mobility-drivers', 'mobility-vehicles', 'mobility-dispatch', 'mobility-safety',
].forEach((id) => expect(`Partner-network page section exists: ${id}`, partnerNetwork.includes(`id="${id}"`) || partnerNetwork.includes(`id:'${id}'`)));

expect('Admin projection publishes four-service counts', ['busProviders', 'hotelProviders', 'flightAgents', 'mobilityPartners'].every((token) => projection.includes(token)));
expect('Admin projection publishes typed mobility partner counts', ['bodaRiders', 'carDrivers', 'fleetOwners', 'mobilityCompanies'].every((token) => projection.includes(token)));
expect('Admin projection exposes partnerNetwork read model', projection.includes('const partnerNetwork = {') && projection.includes('partnerNetwork,'));
expect('Admin projection exposes driver compliance records', projection.includes('mobilityDrivers:') && projection.includes('licenceExpiresAt') && projection.includes('backgroundCheckStatus'));
expect('Admin projection exposes vehicle compliance records', projection.includes('mobilityVehicles:') && projection.includes('insuranceExpiresAt') && projection.includes('inspectionExpiresAt'));
expect('Admin projection exposes live dispatch and safety records', projection.includes('dispatch:') && projection.includes('safetyIncidents:'));
expect('Partner category falls back to company settings for legacy records', projection.includes('company.settings?.partnerCategory'));

expect('Individual boda and car dashboards remove team management', shell.includes("['boda_rider', 'car_driver'].includes(category)") && shell.includes("filter((item) => item.page !== 'staff')"));
expect('Individual mobility menu exposes own vehicle and profile', shell.includes("'My Boda'") && shell.includes("'My Car'") && shell.includes("'My Rider Profile'") && shell.includes("'My Driver Profile'"));
expect('Fleet/company mobility menu retains team, fleet and drivers', shell.includes("{ page: 'staff', label: 'Team'") && shell.includes("{ page: 'taxi-fleet', label: 'My Vehicles'") && shell.includes("{ page: 'taxi-drivers', label: 'My Drivers'"));
expect('Flight company menu remains agent sales and support, not airline operations', shell.includes('Search Live Flights') && shell.includes('Customer Quotes') && shell.includes('Changes & Refunds') && !shell.includes('Create Airline'));

expect('Driver review form posts verificationStatus contract', partnerNetwork.includes('name="verificationStatus"') && partnerNetwork.includes('/admin/mobility/drivers/'));
expect('Driver verification form supplies approved vehicle and compliance evidence', ['name="assignedVehicleId"', 'name="identityVerified"', 'name="backgroundCheckStatus"', 'name="safetyTrainingCompletedAt"', 'name="reviewNotes"'].every((token) => partnerNetwork.includes(token)));
expect('Vehicle review form posts verificationStatus and reviewNotes', partnerNetwork.includes('/admin/mobility/vehicles/') && partnerNetwork.includes('name="reviewNotes"'));
expect('Taxi service accepts the restored driver-review fields', ['payload.verificationStatus', 'payload.assignedVehicleId', 'payload.identityVerified', 'payload.backgroundCheckStatus', 'payload.safetyTrainingCompletedAt', 'payload.reviewNotes'].every((token) => taxiSetup.includes(token)));
expect('Taxi admin routes expose driver, vehicle and dispatch actions', ['/admin/mobility/drivers/:id/review', '/admin/mobility/vehicles/:id/review', '/admin/mobility/rides/:id/dispatch'].every((token) => taxiRoutes.includes(token)));

expect('Super Admin supply dashboards retain platform flight controls', partnerNetwork.includes('/admin/flight-dashboard'));
expect('Super Admin supply dashboards retain platform mobility controls', partnerNetwork.includes('/admin/taxi-dashboard'));
expect('Dashboard copy covers all four service types', workspace.includes('bus, hotel, flight and local mobility'));


try {
  const { buildDashboardShell } = require('../src/services/dashboard/shellConfig');
  const commonProfile = {
    primaryServiceType: 'local_transport', dashboardLabel: 'Driver Dashboard', consoleName: 'Mobility', primaryLabel: 'Driver',
    visiblePages: ['overview','company-profile','taxi-fleet','taxi-drivers','taxi-availability','taxi-operations','taxi-incidents','bookings','reviews','support','revenue','settlement','reports','setup-guide'],
    pageMeta: { overview: ['Driver Dashboard', 'Own operations'] },
  };
  const bodaShell = buildDashboardShell('company', { company: { name: 'Boda One', partnerCategory: 'boda_rider', verificationStatus: 'verified' }, serviceProfile: { ...commonProfile, partnerCategory: 'boda_rider' }, user: { fullName: 'Rider' } });
  const fleetShell = buildDashboardShell('company', { company: { name: 'Fleet One', partnerCategory: 'fleet_owner', verificationStatus: 'verified' }, serviceProfile: { ...commonProfile, partnerCategory: 'fleet_owner', dashboardLabel: 'Mobility Partner Dashboard', visiblePages: [...commonProfile.visiblePages, 'staff'] }, user: { fullName: 'Owner' } });
  const bodaPages = bodaShell.groups.flatMap((group) => group.items.map((item) => `${item.page}:${item.label}`));
  const fleetPages = fleetShell.groups.flatMap((group) => group.items.map((item) => `${item.page}:${item.label}`));
  expect('Boda dashboard runtime menu is individual-only', !bodaPages.some((item) => item.startsWith('staff:')) && bodaPages.includes('taxi-fleet:My Boda') && bodaPages.includes('taxi-drivers:My Rider Profile'));
  expect('Fleet dashboard runtime menu retains staff and fleet management', fleetPages.some((item) => item.startsWith('staff:')) && fleetPages.includes('taxi-fleet:My Vehicles') && fleetPages.includes('taxi-drivers:My Drivers'));
} catch (error) {
  expect(`Mobility dashboard menu smoke: ${error.message}`, false);
}

try {
  const html = compileTemplate(partnerNetwork, 'admin-partner-network.ejs')({
    csrfToken: 'test-csrf',
    dashboardData: {
      partnerNetwork: {
        flightAgents: [{ id: 'agency-1', name: 'Example Agency', country: 'Uganda', city: 'Kampala', licenceNumber: 'AG-1', staffCount: 2, quoteCount: 3, bookingCount: 1, currency: 'UGX', verificationStatus: 'pending' }],
        mobilityPartners: [
          { id: 'boda-1', name: 'Example Rider', partnerCategory: 'boda_rider', partnerLabel: 'Boda rider', country: 'Uganda', city: 'Kampala', vehicleCount: 1, driverCount: 1, activeDriverCount: 0, rideCount: 0, payoutPercent: 100, verificationStatus: 'pending' },
          { id: 'fleet-1', name: 'Example Fleet', partnerCategory: 'fleet_owner', partnerLabel: 'Vehicle, rental or fleet owner', country: 'Kenya', city: 'Nairobi', vehicleCount: 2, driverCount: 2, activeDriverCount: 1, rideCount: 4, payoutPercent: 80, verificationStatus: 'verified' },
        ],
        mobilityDrivers: [{ id: 'driver-1', companyId: 'fleet-1', driverNumber: 'DRV-1', partnerName: 'Example Fleet', licenceClass: 'B', licenceLast4: '1234', vehicleRegistration: 'KAA 001A', assignedVehicleId: 'vehicle-1', identityVerified: true, backgroundCheckStatus: 'clear', safetyTrainingCompletedAt: new Date().toISOString(), verificationStatus: 'pending' }],
        mobilityVehicles: [{ id: 'vehicle-1', companyId: 'fleet-1', partnerName: 'Example Fleet', registrationNumber: 'KAA 001A', makeModel: 'Toyota Axio', year: 2024, vehicleClassId: 'economy', passengerCapacity: 4, verificationStatus: 'verified', operationalStatus: 'offline' }],
        dispatch: [{ id: 'ride-1', rideRef: 'RIDE-1', pickup: 'Home', destination: 'Airport', partnerName: 'Example Fleet', driverNumber: 'DRV-1', vehicleRegistration: 'KAA 001A', currency: 'KES', amount: 2500, status: 'dispatch_pending' }],
        safetyIncidents: [{ id: 'incident-1', rideId: 'ride-1', partnerName: 'Example Fleet', category: 'safety', severity: 'medium', description: 'Example review', status: 'open' }],
      },
    },
  });
  expect('Partner-network template renders all restored workspaces', ['flight-agents','boda-riders','fleet-owners','mobility-drivers','mobility-vehicles','mobility-dispatch','mobility-safety'].every((id) => html.includes(`id="${id}"`)));
  expect('Rendered driver review uses verified vehicle relationship', html.includes('name="assignedVehicleId"') && html.includes('value="vehicle-1"'));
} catch (error) {
  expect(`Partner-network render smoke: ${error.message}`, false);
}

if (failures.length) {
  console.error(`Dashboard service coverage validation failed (${checks.length - failures.length}/${checks.length}).`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Dashboard service coverage validation passed (${checks.length}/${checks.length}).`);

'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const failures = [];
let checks = 0;

function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
function exists(file) { return fs.existsSync(path.join(root, file)); }
function check(condition, message) { checks += 1; if (!condition) failures.push(message); }
function has(file, expression, message) { check(expression.test(read(file)), message); }
function lacks(file, expression, message) { check(!expression.test(read(file)), message); }

const required = [
  'src/config/serviceRegistry.js',
  'src/views/pages/home.ejs',
  'src/views/pages/flight/index.ejs',
  'src/views/pages/flight/offer.ejs',
  'src/views/pages/taxi/index.ejs',
  'src/views/pages/taxi/tracking.ejs',
  'src/modules/flight/services/flightService.js',
  'src/modules/flight/integrations/supplierRegistry.js',
  'src/modules/flight/routes/publicFlightRoutes.js',
  'src/modules/taxi/services/taxiService.js',
  'src/modules/taxi/routes/publicTaxiRoutes.js',
  'src/controllers/company/flightTaxiController.js',
  'src/controllers/employee/driverController.js',
  'src/views/dashboards/shared/sections/flight-operations.ejs',
  'src/views/dashboards/shared/sections/taxi-operations.ejs',
  'scripts/migrate-flight-taxi-domain.js',
];
required.forEach((file) => check(exists(file), `Missing required four-service file: ${file}`));

// Public discovery and UI: all four operational services, no road-map treatment for flight/taxi.
const registry = read('src/config/serviceRegistry.js');
['bus', 'hotel', 'flight', 'taxi'].forEach((service) => {
  check(new RegExp(`${service}:\\s*Object\\.freeze\\(\\{[\\s\\S]*?status:\\s*'active'[\\s\\S]*?bookable:\\s*true`).test(registry), `${service} must be active and bookable`);
});
has('src/views/pages/home.ejs', /href="#bus"[\s\S]*href="#hotel"[\s\S]*href="#flight"[\s\S]*href="#taxi"/, 'Homepage must expose all four active service tabs');
has('src/views/pages/home.ejs', /flight:\s*\{[\s\S]*badge:\s*'Live ticketing'/, 'Homepage flight section must be live');
has('src/views/pages/home.ejs', /taxi:\s*\{[\s\S]*badge:\s*'Secure dispatch'/, 'Homepage taxi section must be live');
check(!/flight:\s*\{[^}]*?(coming soon|soon)/i.test(read('src/views/pages/home.ejs')) && !/taxi:\s*\{[^}]*?(coming soon|soon)/i.test(read('src/views/pages/home.ejs')), 'Flight/taxi service definitions must not be labelled coming soon on homepage');
has('src/routes/web/public.js', /\/listings\/flight\/:slug[\s\S]*\/flights/, 'Generic flight listing URL must redirect to dedicated flight discovery');
has('src/routes/web/public.js', /\/listings\/taxi\/:slug[\s\S]*\/taxi/, 'Generic taxi listing URL must redirect to dedicated taxi booking');
has('src/controllers/public/listingController.js', /function dedicatedServiceUrl[\s\S]*type === 'flight'[\s\S]*type === 'taxi'/, 'Public listing controller must defensively route flight/taxi to dedicated flows');
has('src/services/marketplace/catalogService.js', /serviceType === 'flight'[\s\S]*\/flights\/[\s\S]*serviceType === 'taxi'[\s\S]*\/taxi/, 'Catalog cards must generate dedicated flight/taxi booking URLs');


// Shared dashboard UI must use the same design without falling back to bus-era forms.
const workspaceJs = read('public/js/dashboard-workspace.js');
check(/listingSummaryByService[\s\S]*flight:[\s\S]*Connected airline listing[\s\S]*taxi:[\s\S]*Connected taxi listing/.test(workspaceJs), 'Listing modal must provide flight/taxi-specific architecture guidance');
check(/companyServiceType === 'flight' \|\| companyServiceType === 'taxi'\) return null/.test(workspaceJs), 'Generic desk-booking modal must fail closed for flight/taxi');
check(/companyServiceType === 'flight' \? \[/.test(workspaceJs) && /companyServiceType === 'taxi' \? \[/.test(workspaceJs), 'Listing modal must expose dedicated airline and taxi fields');
check(/listingActivationHelpByService[\s\S]*External schedules also require a certified supplier adapter[\s\S]*compliant vehicle and verified safety-cleared driver/.test(workspaceJs), 'Listing activation help must explain real flight/taxi readiness');
check(/bookingsFlightTable/.test(workspaceJs) && /bookingsTaxiTable/.test(workspaceJs), 'Dashboard renderer must populate separate flight and taxi booking tables');
const bookingSection = read('src/views/dashboards/shared/sections/bookings.ejs');
check(/href="\/flights"[\s\S]*Create live flight booking/.test(bookingSection), 'Flight booking action must use live verified flight checkout');
check(/href="\/taxi"[\s\S]*Create verified ride booking/.test(bookingSection), 'Taxi booking action must use signed quote checkout');
check(/bookingsFlightTable/.test(bookingSection) && /bookingsTaxiTable/.test(bookingSection), 'Booking workspace must include all four service tabs');
const listingSection = read('src/views/dashboards/shared/sections/listings.ejs');
check(/Create flight listing/.test(listingSection) && /Create taxi listing/.test(listingSection), 'Listing workspace must label flight/taxi actions explicitly');
check(/showSharedPricingRules = !isCompanyDashboard \|\| companySupportsBus \|\| companySupportsHotel/.test(listingSection), 'Flight/taxi providers must use their dedicated fare engines instead of generic price rules');
const sharedWorkspace = read('src/views/dashboards/shared/workspace.ejs');
check(/Create live flight booking[\s\S]*Create verified ride booking/.test(sharedWorkspace), 'Employee quick actions must use verified flight/taxi booking flows');
const dynamicPage = read('src/views/dashboards/shared/sections/dynamic-page.ejs');
check(/item.page === 'bookings' && companySupportsFlight[\s\S]*href="\/flights"[\s\S]*companySupportsTaxi[\s\S]*href="\/taxi"/.test(dynamicPage), 'Dynamic employee booking pages must not reopen generic bus forms');

// Persistent shared contracts.
['src/models/Booking.js', 'src/models/BookingItem.js', 'src/models/Listing.js', 'src/models/SavedListing.js'].forEach((file) => {
  has(file, /enum:\s*\[['"]bus['"],\s*['"]hotel['"],\s*['"]flight['"],\s*['"]taxi['"]\]/, `${file} must persist all four service types`);
});
['src/models/PartnerLead.js', 'src/models/Agreement.js', 'src/models/Invitation.js'].forEach((file) => {
  has(file, /['"]flight['"][\s\S]*['"]taxi['"]/, `${file} must support flight and taxi onboarding`);
});
has('src/models/Company.js', /ALL_SERVICE_TYPES/, 'Company schema must use the central service registry');

// Flight: native inventory plus fail-closed external suppliers.
const supplier = read('src/modules/flight/integrations/supplierRegistry.js');
['verifyOffer', 'holdOffer', 'confirmOrder', 'releaseHold', 'refundOrder'].forEach((method) => check(supplier.includes(`'${method}'`), `Flight supplier adapter must require ${method}`));
has('src/modules/flight/integrations/supplierRegistry.js', /certified integration is not active[\s\S]*No payment has been taken/, 'Unavailable external flight suppliers must fail closed before payment');
const flight = read('src/modules/flight/services/flightService.js');
check(/assertScheduleSupplierAvailable/.test(flight) && /supplierIsAvailable/.test(flight), 'Flight search and checkout must enforce supplier availability');
check(/holdOffer/.test(flight) && /confirmOrder/.test(flight) && /refundOrder/.test(flight), 'External flight lifecycle must hold, confirm and refund through the adapter');
check(/claimSeats/.test(flight) && /releaseOrderSeats/.test(flight), 'Native flight lifecycle must atomically hold and release seats');
check(/FlightTicket/.test(flight) && /ticketNumber/.test(flight), 'Successful native/external flight confirmation must persist tickets');
check(/flight\.listing\.published/.test(flight) && /flight_listing_not_ready/.test(flight), 'Flight listings must pass service-specific readiness before publication');
check(/passengerType/.test(flight) && /documentExpiry/.test(flight) && /specialServiceRequests/.test(flight), 'Flight checkout must validate traveler category, documents and assistance requests');

// Taxi: server pricing, safe fleet, assigned dispatch and ride fulfilment.
const taxi = read('src/modules/taxi/services/taxiService.js');
check(/createHmac\('sha256', env\.sessionSecret\)/.test(taxi) && /timingSafeEqual/.test(taxi), 'Taxi quote and access tokens must be cryptographically protected');
check(/inspectionExpiresAt/.test(taxi) && /insuranceExpiresAt/.test(taxi) && /vehicleIsCompliant/.test(taxi), 'Taxi vehicles must require current inspection and insurance');
check(/passengerCapacity/.test(taxi) && /luggageCapacity/.test(taxi) && /wheelchairAccessible/.test(taxi), 'Taxi quotes must enforce passenger, luggage and accessibility requirements');
check(/Only paid taxi rides can be dispatched/.test(taxi), 'Taxi rides must be paid before dispatch');
check(/assignedDriverId:\s*\{ \$in: \[null, ''\] \}/.test(taxi), 'Taxi dispatch must atomically claim an unassigned ride');
check(/pickupPinHash/.test(taxi) && /trackingTokenHash/.test(taxi), 'Taxi pickup and tracking secrets must be stored as hashes');
check(/taxi\.listing\.published/.test(taxi) && /taxi_listing_not_ready/.test(taxi), 'Taxi listings must pass service-specific readiness before publication');
const driver = read('src/controllers/employee/driverController.js');
check(/assignedDriverId:\s*\{ \$in: driverIds \}/.test(driver), 'Taxi driver dashboard/export must be limited to assigned rides');
check(!/taxiRides\.list\(\{\s*companyId:\s*companyId\(req\)\s*\}\)/.test(driver), 'Taxi drivers must not receive all company rides as a fallback');

// Payments, recovery and shared fulfilment.
const webhook = read('src/services/payment/webhookService.js');
check(/flightService\.confirmPayment/.test(webhook) && /flightService\.failPayment/.test(webhook) && /flightService\.refundBooking/.test(webhook), 'Flight payment callbacks must enter the flight domain lifecycle');
check(/taxiService\.confirmPayment/.test(webhook) && /taxiService\.failPayment/.test(webhook) && /taxiService\.refundBooking/.test(webhook), 'Taxi payment callbacks must enter the taxi domain lifecycle');
const expiry = read('src/jobs/expirePaymentIntents.js');
check(/flightService\.failPayment/.test(expiry) && /taxiService\.failPayment/.test(expiry), 'Payment expiry must release flight and taxi inventory');
has('src/jobs/scheduler.js', /dispatchTaxiRides/, 'Scheduled taxi dispatch worker must be registered');
has('src/views/pages/ticket.ejs', /isFlight[\s\S]*isTaxi[\s\S]*Track ride/, 'Shared customer ticket must render flight and taxi fulfilment correctly');
lacks('src/views/pages/listing-details.ejs', />Coming soon</, 'Inactive listings must show an honest unavailable state instead of pretending an implemented service is coming soon');
check(!Object.prototype.hasOwnProperty.call(require('../package.json').scripts, 'seed:airports') && Object.prototype.hasOwnProperty.call(require('../package.json').scripts, 'bootstrap:airports'), 'Airport reference data must be a bootstrap, not a second business-data seed');
has('src/services/pdf/ticketPdfService.js', /Classic Trip Flight Ticket[\s\S]*Classic Trip Ride Confirmation/, 'PDF service must generate service-specific flight and taxi documents');

// Tenant-scoped provider/employee operations and least privilege.
const companyRoutes = read('src/routes/web/company.js');
check(/requireCompanyService\('flight'\)/.test(companyRoutes) && /flights\/schedules\/:scheduleId\/manifest/.test(companyRoutes), 'Airline company operations must be service scoped');
check(/requireCompanyService\('taxi'\)/.test(companyRoutes) && /taxi\/dispatch/.test(companyRoutes), 'Taxi company operations must be service scoped');
const employeeRoutes = read('src/routes/web/employee.js');
check(/\/employee\/flights\/schedules\/:scheduleId\/manifest/.test(employeeRoutes), 'Airline staff must have a scoped manifest route');
check(/requirePermission\('flight\.ticket\.update'\)/.test(employeeRoutes), 'Airline ticket transitions must require exact permission');
check(/requirePermission\('taxi\.dispatch'\)/.test(employeeRoutes) && /requirePermission\('taxi\.fleet\.manage'\)/.test(employeeRoutes), 'Taxi dispatch/fleet actions must require exact permissions');
has('src/controllers/company/flightTaxiController.js', /effectivePermissionsFresh[\s\S]*canUpdateTickets/, 'Manifest controls must use fresh employee permissions');
has('src/services/dashboard/shellConfig.js', /flight-operations[\s\S]*taxi-operations/, 'Dashboard shell must expose dedicated airline and taxi operations pages');
has('src/services/dashboard/mongoDashboardService.js', /flightSchedules[\s\S]*flightTickets[\s\S]*taxiServiceZones[\s\S]*taxiRides/, 'Employee projection must load tenant-scoped flight and taxi operational records');

// Safety boundaries and migrations.
has('src/services/promoter/offlineSalesService.js', /Offline sales are enabled only for live bus and hotel inventory/, 'Manual/offline sales must reject flight/taxi because they require live offer or signed quote verification');
has('scripts/migrate-flight-taxi-domain.js', /--apply[\s\S]*local_transport/, 'Legacy taxi aliases must be handled only by an explicit dry-run/apply migration');
check(!exists('src/seeds/seedEastAfricaAirports.js'), 'Production seeds directory must contain only the Super Admin seed');
const legacyHits = [];
for (const base of ['src', 'scripts']) {
  const stack = [path.join(root, base)];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (/\.(js|ejs)$/.test(entry.name) && fs.readFileSync(full, 'utf8').includes('local_transport')) legacyHits.push(path.relative(root, full));
    }
  }
}
const allowedLegacy = new Set(['src/config/serviceRegistry.js', 'src/views/pages/auth/_partner-signup.ejs', 'scripts/check-partner-registration-and-user-identity.js', 'scripts/check-flight-taxi-release.js', 'scripts/check-four-service-end-to-end.js', 'scripts/migrate-flight-taxi-domain.js']);
check(legacyHits.every((file) => allowedLegacy.has(file)), `Legacy local_transport appears outside compatibility/migration files: ${legacyHits.filter((file) => !allowedLegacy.has(file)).join(', ')}`);

if (failures.length) {
  console.error(`Four-service end-to-end validation failed (${failures.length}/${checks}):`);
  failures.forEach((failure, index) => console.error(`${index + 1}. ${failure}`));
  process.exit(1);
}
console.log(`Four-service end-to-end validation passed (${checks}/${checks}).`);

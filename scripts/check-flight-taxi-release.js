'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const failures = [];
let checks = 0;
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
function check(condition, message) { checks += 1; if (!condition) failures.push(message); }
function exists(file) { return fs.existsSync(path.join(root, file)); }

[
  'src/models/Airport.js','src/models/Aircraft.js','src/models/FlightFare.js','src/models/FlightSchedule.js','src/models/FlightOrder.js','src/models/FlightTicket.js',
  'src/models/TaxiServiceZone.js','src/models/TaxiVehicle.js','src/models/TaxiFareRule.js','src/models/TaxiRide.js','src/models/TaxiRideEvent.js',
  'src/modules/flight/services/flightService.js','src/modules/taxi/services/taxiService.js',
  'src/modules/flight/routes/publicFlightRoutes.js','src/modules/taxi/routes/publicTaxiRoutes.js',
  'src/views/dashboards/shared/sections/flight-operations.ejs','src/views/dashboards/shared/sections/taxi-operations.ejs',
  'src/views/pages/flight/index.ejs','src/views/pages/flight/offer.ejs','src/views/pages/taxi/index.ejs','src/views/pages/taxi/tracking.ejs',
  'scripts/migrate-flight-taxi-domain.js','src/data/eastAfricaAirports.js',
].forEach((file) => check(exists(file), `Missing flight/taxi release file: ${file}`));

const registry = read('src/config/serviceRegistry.js');
check(/flight:.*status:\s*'active'.*bookable:\s*true/s.test(registry), 'Flight must be active and bookable');
check(/taxi:.*status:\s*'active'.*bookable:\s*true/s.test(registry), 'Taxi must be active and bookable');
check(/local_transport.*taxi/.test(registry), 'Legacy local_transport alias must normalize to taxi');

const app = read('src/app.js');
check(/\/api\/v1\/flights/.test(app) && /publicFlightRoutes/.test(app), 'Flight API must be mounted');
check(/\/api\/v1\/taxi/.test(app) && /publicTaxiRoutes/.test(app), 'Taxi API must be mounted');

const flight = read('src/modules/flight/services/flightService.js');
check(/claimSeats/.test(flight) && /held:\$\{orderId\}/.test(flight), 'Flight booking must atomically hold named seats');
check(/flight_confirmation_reconciliation_required/.test(flight), 'Flight payment confirmation must fail to reconciliation when seats cannot be confirmed');
check(/FlightTicket/.test(flight) && /ticketNumber/.test(flight) && /qrTokenHash/.test(flight), 'Flight confirmation must issue persisted hashed tickets');
check(/releaseOrderSeats/.test(flight) && /failPayment/.test(flight) && /refundBooking/.test(flight), 'Flight failure/refund must release inventory');
check(/companyId:\s*clean\(companyId\)/.test(flight) || /companyId:\s*companyId/.test(flight), 'Flight partner operations must be company scoped');
check(/supplierType/.test(read('src/models/FlightSchedule.js')), 'Flight schedules must preserve supplier boundary metadata');

const taxi = read('src/modules/taxi/services/taxiService.js');
check(/createHmac\('sha256', env\.sessionSecret\)/.test(taxi) && /taxi_quote_tampered/.test(taxi), 'Taxi quotes must be signed and verified');
check(/timingSafeEqual/.test(taxi) && /pickupPinHash/.test(taxi) && /trackingTokenHash/.test(taxi), 'Taxi pickup and tracking secrets must be hash protected');
check(/assignedDriverId:\s*\{ \$in: \[null, ''\] \}/.test(taxi), 'Taxi assignment must be atomic');
check(/Only paid taxi rides can be dispatched/.test(taxi), 'Taxi dispatch must require successful payment');
check(/identityQuery\.companyId/.test(taxi), 'Taxi partner ride transitions must be company scoped');
check(/dispatchDueRides\(limit = 100, companyId = ''\)/.test(taxi), 'Taxi dispatch batch must support tenant scope');
check(/customer_no_show/.test(taxi) && /in_progress/.test(taxi) && /completed/.test(taxi), 'Taxi lifecycle must include no-show, active ride and completion');

const taxiRoutes = read('src/modules/taxi/routes/publicTaxiRoutes.js');
check(/scopedCompanyId\(req\)/.test(taxiRoutes), 'Taxi operational APIs must derive company scope from authenticated identity');
check(/crypto\.timingSafeEqual/.test(taxiRoutes), 'Taxi cancellation token comparison must be timing safe');
check(/requirePermission\('taxi\.ride\.update'\)/.test(taxiRoutes) && /requirePermission\('taxi\.location\.update'\)/.test(taxiRoutes), 'Taxi driver APIs must enforce atomic permissions');

const webhook = read('src/services/payment/webhookService.js');
check(/flightService\.confirmPayment/.test(webhook) && /flightService\.failPayment/.test(webhook) && /flightService\.refundBooking/.test(webhook), 'Payment webhooks must invoke flight lifecycle');
check(/taxiService\.confirmPayment/.test(webhook) && /taxiService\.failPayment/.test(webhook) && /taxiService\.refundBooking/.test(webhook), 'Payment webhooks must invoke taxi lifecycle');
const expiry = read('src/jobs/expirePaymentIntents.js');
check(/flightService\.failPayment/.test(expiry) && /taxiService\.failPayment/.test(expiry), 'Expired payment intents must release flight/taxi inventory');
check(/dispatchTaxiRides/.test(read('src/jobs/scheduler.js')) && /dispatchTaxiRides/.test(read('src/config/env.js')), 'Scheduled taxi dispatch must be registered and configurable');

const companyRoutes = read('src/routes/web/company.js');
check(/requireCompanyService\('flight'\)/.test(companyRoutes) && /flights\/schedules\/:scheduleId\/manifest/.test(companyRoutes), 'Flight partner operations and manifests must be service scoped');
check(/requireCompanyService\('taxi'\)/.test(companyRoutes) && /taxi\/dispatch/.test(companyRoutes), 'Taxi partner operations and dispatch must be service scoped');
const dashboardController = read('src/controllers/company/dashboardController.js');
check(/'\/company\/flight-operations': 'flight-operations'/.test(dashboardController), 'Flight dashboard URL must open the flight page');
check(/'\/company\/taxi-operations': 'taxi-operations'/.test(dashboardController), 'Taxi dashboard URL must open the taxi page');
check(/!\['flight', 'taxi'\]\.includes\(serviceType\)/.test(dashboardController), 'Flight/taxi operational pages must not render duplicate dynamic sections');

const access = read('src/config/accessControl.js');
['flight_operations','ticketing_agent','dispatcher','fleet_manager','taxi_driver'].forEach((role) => check(access.includes(role), `Missing staff permission default: ${role}`));
check(/flight\.manifest/.test(access) && /flight\.ticket\.update/.test(access), 'Flight permissions must be explicit');
check(/taxi\.dispatch/.test(access) && /taxi\.fleet\.manage/.test(access), 'Taxi permissions must be explicit');

const ticket = read('src/views/pages/ticket.ejs');
const pdf = read('src/services/pdf/ticketPdfService.js');
check(/isFlight/.test(ticket) && /isTaxi/.test(ticket) && /Track ride/.test(ticket), 'Shared customer ticket must present flight and taxi correctly');
check(/Classic Trip Flight Ticket/.test(pdf) && /Classic Trip Ride Confirmation/.test(pdf), 'PDF documents must be service specific');
check(!/['"]UGX['"]/.test(read('src/views/dashboards/shared/sections/flight-operations.ejs')), 'Flight dashboard must inherit platform/company currency');
check(!/['"]UGX['"]/.test(read('src/views/dashboards/shared/sections/taxi-operations.ejs')), 'Taxi dashboard must inherit platform/company currency');

const migration = read('scripts/migrate-flight-taxi-domain.js');
check(/dry-run/.test(migration) && /--apply/.test(migration), 'Flight/taxi migration must default to dry run and require apply');
check(/bootstrapEastAfricaAirports/.test(migration), 'Flight/taxi migration must bootstrap airport reference data');
check(!exists('src/seeds/seedEastAfricaAirports.js'), 'Only Super Admin may remain in the production seeds folder');

if (failures.length) {
  console.error(`Flight/taxi release validation failed (${failures.length}/${checks}):`);
  failures.forEach((failure,index) => console.error(`${index+1}. ${failure}`));
  process.exit(1);
}
console.log(`Flight/taxi release validation passed (${checks}/${checks}).`);

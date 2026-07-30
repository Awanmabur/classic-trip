'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0;
function read(file) {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8');
}
function check(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
    return;
  }
  passed += 1;
}
function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  return from >= 0 && to > from ? source.slice(from, to) : '';
}

const snapshot = read('src/services/dashboard/dashboardSnapshotService.js');
const projection = read('src/services/dashboard/dashboardProjectionEngine.js');
const dashboardService = read('src/services/dashboard/mongoDashboardService.js');
const auth = read('src/controllers/auth/authController.js');
const security = read('src/services/security/securityService.js');
const departure = read('src/modules/bus/services/busDepartureService.js');
const scheduleController = read('src/controllers/company/scheduleController.js');
const onboarding = read('src/services/company/busServiceOnboarding.js');
const env = read('src/config/env.js');

const pageMap = section(snapshot, 'const COMPANY_PAGE_ENTITIES', 'const COMPANY_PAGE_ALIASES');
check(/schedules:\s*new Set\(\[[\s\S]*?'companyEmployees'[\s\S]*?'routes'[\s\S]*?'vehicles'[\s\S]*?'fareProducts'[\s\S]*?'schedules'/.test(pageMap), 'Departure pages must load saved drivers and every required route/vehicle/fare relation.');
check(/listings:\s*new Set\(\[[\s\S]*?'companyBranches'[\s\S]*?'companyEmployees'/.test(pageMap), 'Listing setup must load branches and staff relations.');
check(/routes:\s*new Set\(\[[\s\S]*?'companyBranches'[\s\S]*?'routeStops'[\s\S]*?'busSegmentFares'/.test(pageMap), 'Route setup must load branches, stops and stop-dependent fares.');
check(/bookings:\s*new Set\(\[[\s\S]*?'busSeatSegmentInventories'[\s\S]*?'hotelReservations'[\s\S]*?'flightOrders'/.test(pageMap), 'Booking pages must load the canonical inventory and reservation records for every service.');
check(/mobility:\s*new Set\(\[[\s\S]*?'companyEmployees'[\s\S]*?\.\.\.COMPANY_SERVICE_ENTITIES\.local_transport/.test(pageMap) && snapshot.includes("'taxiVehicles','taxiDriverProfiles'"), 'Mobility pages must load company staff and taxi-driver profiles together.');
check(/support:\s*new Set\(\[[\s\S]*?'schedules'[\s\S]*?'rescheduleRequests'/.test(pageMap), 'Support and reschedule pages must load their departure relationships.');

check(snapshot.includes("if (entity === 'notifications')") && snapshot.includes("ownerType: 'company', ownerId: companyId"), 'Company notifications must use their real owner relation.');
check(snapshot.includes("if (entity === 'bookings')") && snapshot.includes('{ agentCompanyId: companyId }') && snapshot.includes('{ providerCompanyId: companyId }'), 'Partner bookings must include agent and provider ownership relations.');
check(snapshot.includes("['flightAgentQuotes', 'flightChangeRequests', 'flightRefundRequests']"), 'Flight-agent workflows must use agentCompanyId instead of an invalid generic company filter.');
check(snapshot.includes('const [company, directUsers, platformSettings] = await Promise.all'), 'Dashboard shell reads must run concurrently.');
check(snapshot.includes('dashboardReadConcurrency') && snapshot.includes('readSharedSnapshot') && snapshot.includes('writeSharedSnapshot'), 'Dashboard snapshots must use configurable parallel reads and shared Redis cache.');
check(env.includes('DASHBOARD_DB_READ_CONCURRENCY'), 'Dashboard database concurrency must be deployment-configurable.');

check(projection.includes('const driverSelectorOptions = assignableDriverEmployees.map(driverOption)'), 'Departure selectors must expose all saved assignable drivers.');
check(departure.includes('evaluateDriverAssignment(employee, user || {})') && !departure.includes("normalize(employee.status) !== 'active'"), 'Backend driver assignment must match the selector contract.');
check(departure.includes('publicationDeferred') && departure.includes('Departure was saved as Draft'), 'Failed publication readiness must preserve a newly created Draft departure.');
check(scheduleController.includes('publicationDeferred') && scheduleController.includes("'warning',"), 'The departure controller must explain a publication deferral instead of presenting creation as a failure.');
check(onboarding.includes("created.schedule.status === 'published'"), 'Complete setup must publish its listing only after the departure was truly published.');

check(auth.includes('prewarmForUser(user)') && dashboardService.includes("activePage: 'overview'"), 'Login must prewarm the exact first dashboard page.');
check(security.includes('localLoginFailures') && !section(security, 'async function recentFailedLoginCountLive', 'async function recordLoginAttempt').includes('loginAudits'), 'Login failure throttling must stay off the historical audit query path.');
check(dashboardService.includes('hotelManifestDate') && dashboardService.includes('hotelManifestListingId'), 'Dashboard projection cache keys must include page filters.');

const { evaluateDriverAssignment, evaluateDriverEligibility } = require('../src/services/company/driverEligibilityService');
const savedDriver = {
  id: 'saved-driver',
  roleTitle: 'Driver',
  status: 'invited',
  safetyStatus: 'pending_review',
  serviceCategories: ['driver'],
  permissions: [],
};
const assignment = evaluateDriverAssignment(savedDriver, {});
const operational = evaluateDriverEligibility(savedDriver, {});
check(assignment.assignable === true, 'A saved company driver without an account must be assignable.');
check(operational.eligible === false && assignment.operational === false, 'Operational readiness must remain a separate stricter diagnostic.');

if (!process.exitCode) {
  console.log(`Dashboard workflow relationship verification passed (${passed}/${passed}).`);
}

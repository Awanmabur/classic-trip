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
function read(file) {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8');
}

const snapshot = read('src/services/dashboard/dashboardSnapshotService.js');
const projection = read('src/services/dashboard/dashboardProjectionEngine.js');
const workspace = read('public/js/dashboard-workspace.js');
const departure = read('src/modules/bus/services/busDepartureService.js');
const eligibilityService = read('src/services/company/driverEligibilityService.js');
const busOnboarding = read('src/services/company/busServiceOnboarding.js');
const staffView = read('src/views/dashboards/shared/sections/staff.ejs');
const setupGuide = read('src/views/dashboards/shared/sections/setup-guide.ejs');

const companyService = read('src/services/company/companyService.js');
const companyRoutes = read('src/routes/web/company.js');
const companyOperationsController = read('src/controllers/company/operationsController.js');
const userModel = read('src/models/User.js');
const verificationReviewModel = read('src/models/VerificationReview.js');
check(companyService.includes('async function activateDriverByCompany'), 'Partner Admin driver activation service must exist.');
check(companyService.includes("user.verificationStatus = 'company_verified'"), 'Partner Admin activation must store an auditable operational verification state.');
check(companyService.includes("approvalOwner: 'partner_admin'"), 'Partner Admin activation must be the authoritative employee approval path.');
check(companyService.includes('...REQUIRED_DRIVER_PERMISSIONS'), 'Partner Admin activation must grant the complete required driver permission set.');
check(companyRoutes.includes("/company/drivers/:id/activate"), 'Company dashboard must expose a scoped driver activation route.');
check(companyOperationsController.includes('activateDriverByCompany'), 'Company activation controller must call the scoped service.');
check(workspace.includes("key === 'driver activation'"), 'Dashboard must provide the Partner Admin driver activation form.');
check(workspace.includes('Manage driver status') && workspace.includes('Set driver active'), 'Driver rows must expose Partner Admin status controls regardless of account stage.');
check(userModel.includes("'company_verified'"), 'User model must support company-verified operational drivers.');
check(verificationReviewModel.includes("'company_activated'"), 'Verification review must preserve the Partner Admin activation audit state.');

check(snapshot.includes("'invitations','verificationReviews'"), 'Company snapshot must load invitations and verification reviews.');
check(projection.includes('const companyInvitations ='), 'Company dashboard must scope invitations.');
check(projection.includes('const driverRequestTickets ='), 'Company dashboard must scope driver request tickets.');
check(projection.includes('staffLifecycleRows'), 'Staff table must merge employee and invitation lifecycle rows.');
check(projection.includes('driverLifecycleRows'), 'Driver table must merge request, invitation, verification and employee lifecycle rows.');
check(projection.includes('Legacy request · Partner Admin action required'), 'Legacy driver requests must be transferred visibly to Partner Admin ownership.');
check(projection.includes("'Invitation sent · awaiting acceptance'"), 'Invitation acceptance stage must be visible.');
check(projection.includes('operational warning:'), 'Driver lifecycle rows must explain why a driver is not operational.');
check(projection.includes('Assignable · Partner Admin approved · operational') && projection.includes('Assignable · platform verified · operational'), 'Operational driver stages must remain visible while assignment stays separate.');
check(projection.includes('pendingStaffInvitations:'), 'Pending staff invitations must be exposed to the frontend.');
check(projection.includes('pendingDriverRequests:'), 'Pending driver requests must be exposed to the frontend.');
check(projection.includes('const driverSelectorOptions = activeDriverEmployees.map(driverOption)'), 'Only operational drivers must populate dependent selectors.');
check(projection.includes('evaluateDriverAssignment(employee, account)'), 'Driver selectors must use the shared assignment resolver.');
check(eligibilityService.includes("normalize(employee.safetyStatus) !== 'cleared'"), 'Shared driver eligibility must require safety clearance.');
check(eligibilityService.includes('REQUIRED_DRIVER_PERMISSIONS.filter'), 'Shared driver eligibility must require operational permissions.');
check(workspace.includes("required:false, help:driverWorkflowHint"), 'Draft departure form must not require a driver unconditionally.');
check(workspace.includes("key === 'schedule rule'") && workspace.includes("value:hasAssignableDriver ? 'active' : 'draft'"), 'Recurring schedule setup may activate only when an operational driver is selectable.');
check(workspace.includes("name:'schedule[driverId]'") && workspace.includes("options:drivers, required:false, help:driverWorkflowHint"), 'Complete bus setup must not require a driver before Draft save.');
check(busOnboarding.includes('publicationDeferred: requestedPublishListing && !publishListing'), 'Complete bus setup must downgrade safely to Draft when publication was requested without a driver.');
check(workspace.includes("value:hasAssignableDriver ? 'published' : 'draft'"), 'Departure form may default to Published only when an operational driver is selectable.');
check(workspace.includes('Draft departure ready:'), 'Smart form must explain that dependencies can be saved while driver approval is pending.');
check(workspace.includes('pendingDriverRequests.length'), 'Schedule form must surface pending driver workflow count.');
check(departure.includes('evaluateDriverAssignment(employee, user || {})'), 'Backend driver selection must use the same shared assignment resolver as the dashboard.');
check(eligibilityService.includes("OPERATIONAL_DRIVER_VERIFICATION_STATUSES"), 'Driver eligibility must accept audited Partner Admin or platform verification.');
check(departure.includes("failures.push('verified_operational_driver_missing')"), 'Publish validation must require an assigned operational driver.');
check(staffView.includes('Super Admin approves only the partner company') && staffView.includes('Partner Admin creates, invites, activates'), 'Staff page must explain final approval ownership.');
check(staffView.includes('pendingDriverCount'), 'Staff page must display pending driver count.');
check(setupGuide.includes('Only an active, verified, licensed and safety-cleared driver'), 'Setup guide must explain strict operational driver assignment.');
check(snapshot.includes('linkedEmployeeUserIds'), 'Company snapshot must load accounts linked by company employee membership.');


// Exercise the real dashboard projection without loading Mongoose. This catches
// regressions where the database records exist but the company dashboard drops
// them because it reads only CompanyEmployee rows.
const Module = require('module');
const originalModuleLoad = Module._load;
Module._load = function patchedModuleLoad(request, parent, isMain) {
  if (String(request).endsWith('platformConfigService')) {
    return {
      getCachedPlatformConfig: () => ({
        defaultCurrency: 'UGX',
        supportedCurrencies: ['UGX'],
        financeRules: {
          defaultCurrency: 'UGX',
          supportedCurrencies: ['UGX'],
          customerServiceFeePercent: 0,
          partnerCommissionPercent: 10,
          promoterSharePercent: 30,
          bookingHoldMinutes: 10,
        },
      }),
      SYSTEM_DEFAULTS: { defaultCurrency: 'UGX' },
    };
  }
  return originalModuleLoad.apply(this, arguments);
};

function projectionState(overrides = {}) {
  const arrayKeys = [
    'categories','users','companies','listings','partnerLeads','discoverySessions','agreements',
    'invitations','verificationReviews','routes','vehicles','schedules','seats','rooms',
    'hotelProperties','roomTypes','roomUnits','roomNightInventories','stayRules',
    'companyEmployees','companyBranches','companyPolicies','driverAssignments','driverIncidents',
    'tripStatusUpdates','routeStops','carts','cartCheckoutAttempts','bookingGroups','bookings',
    'passengers','payments','correspondenceMessages','bookingTimelineEvents',
    'notificationDeliveryAttempts','pushSubscriptions','rescheduleRequests','wallets',
    'walletTransactions','paymentIntents','paymentWebhookEvents','receiptInvoices','taxFeeRecords',
    'financeStatements','financeRiskReviews','settlementBatches','payoutRequests','payoutBatches',
    'reconciliationReports','promoterLinks','referralClicks','attributionSessions',
    'campaignConversions','agentProfiles','offlineSales','fraudSignals','commissions','blogs',
    'reviews','notifications','supportTickets','refundRequests','promotionCampaigns','auditLogs',
    'securityEvents','loginAudits','deviceSessions','idempotencyKeyRecords','savedListings',
    'shiftHandovers','inventoryHolds','inventoryHoldItems',
    'outboxEvents','ticketScans','scheduleRules','notificationTemplates','fareProducts',
    'segmentFares','seatMapTemplates','seatMapVersions',
  ];
  const state = {
    platformSettings: { financeRules: { defaultCurrency: 'UGX', partnerCommissionPercent: 10, promoterSharePercent: 30 } },
    ...overrides,
  };
  arrayKeys.forEach((key) => {
    if (!Array.isArray(state[key])) state[key] = [];
  });
  return state;
}

try {
  const { createDashboardProjection } = require('../src/services/dashboard/dashboardProjectionEngine');
  const pendingState = projectionState({
    companies: [{ id: 'company-1', name: 'Test Bus Company', companyType: 'bus', status: 'active', verificationStatus: 'verified', operatingCurrency: 'UGX' }],
    listings: [{ id: 'listing-1', companyId: 'company-1', title: 'Test Bus', serviceType: 'bus', status: 'draft', currency: 'UGX' }],
    invitations: [
      { id: 'invite-staff-1', companyId: 'company-1', type: 'staff', status: 'sent', fullName: 'Pending Staff', email: 'staff@example.com', permissions: ['booking.view'] },
      { id: 'invite-driver-1', companyId: 'company-1', type: 'driver', status: 'sent', fullName: 'Pending Driver', email: 'driver@example.com', phone: '+256700000001', licenseNumber: 'DL-1', meta: { driverEmployeeId: 'driver-employee-pending' } },
    ],
    companyEmployees: [{ id: 'driver-employee-pending', companyId: 'company-1', userId: '', fullName: 'Pending Driver', email: 'driver@example.com', phone: '+256700000001', roleTitle: 'Driver', status: 'invited', safetyStatus: 'not_submitted', licenseNumber: 'DL-1', permissions: ['manifest.view', 'checkin.assist', 'trip.status.update', 'incident.create'], serviceCategories: ['driver'], invitationId: 'invite-driver-1' }],
  });
  const pendingDashboard = createDashboardProjection(pendingState).dashboardData('company', { companyId: 'company-1' });
  check(pendingDashboard.staff.some((row) => row[0] === 'Pending Staff' && /awaiting acceptance/i.test(row[5])), 'Saved staff invitation must render before CompanyEmployee exists.');
  check(pendingDashboard.drivers.some((row) => row[0] === 'Pending Driver'), 'Saved Partner Admin driver record must render in onboarding before account setup.');
  check(pendingDashboard.staffDriverWorkflow.pendingStaff === 1, 'Pending staff workflow count must include saved invitations.');
  check(pendingDashboard.staffDriverWorkflow.pendingDrivers === 1, 'Pending driver workflow count must include Partner Admin invitations.');
  check(pendingDashboard.options.drivers.length === 0, 'A pending Partner Admin driver record must not enter operational selectors.');
  check(pendingDashboard.options.pendingDriverRequests.length === 1, 'Pending Partner Admin driver invitation must be exposed to smart forms.');
  check(pendingDashboard.staffDriverWorkflow.canPublishDeparture === false, 'A pending driver request must not unlock departure publication.');

  const blockedDriverState = projectionState({
    companies: pendingState.companies, listings: pendingState.listings,
    users: [{ id: 'driver-user-blocked', fullName: 'Blocked Driver', role: 'driver', status: 'active', verificationStatus: 'company_verified' }],
    companyEmployees: [{ id: 'driver-employee-blocked', companyId: 'company-1', userId: 'driver-user-blocked', roleTitle: 'Driver', status: 'active', safetyStatus: 'pending_review', licenseNumber: 'DL-3', permissions: ['manifest.view', 'checkin.assist', 'trip.status.update', 'incident.create'], serviceCategories: ['driver'] }],
  });
  const blockedDashboard = createDashboardProjection(blockedDriverState).dashboardData('company', { companyId: 'company-1' });
  check(blockedDashboard.options.drivers.length === 0, 'A safety-pending driver must be excluded from departure selectors.');
  check(blockedDashboard.options.driverEligibility.some((row) => row.value === 'driver-employee-blocked' && row.assignable === false && row.operational === false && row.operationalReasons.some((reason) => /safety clearance/i.test(reason))), 'Driver diagnostics must explain the blocking safety requirement.');

  const activeDriverState = projectionState({
    companies: pendingState.companies,
    listings: pendingState.listings,
    users: [{ id: 'driver-user-1', companyId: 'company-1', fullName: 'Verified Driver', role: 'driver', status: 'active', verificationStatus: 'company_verified' }],
    companyEmployees: [{
      id: 'driver-employee-1', companyId: 'company-1', userId: 'driver-user-1', roleTitle: 'Driver',
      status: 'active', safetyStatus: 'cleared', licenseNumber: 'DL-2',
      permissions: ['manifest.view', 'checkin.assist', 'trip.status.update', 'incident.create'],
      serviceCategories: ['driver'],
    }],
  });
  const activeDashboard = createDashboardProjection(activeDriverState).dashboardData('company', { companyId: 'company-1' });
  check(activeDashboard.options.drivers.length === 1 && activeDashboard.options.drivers[0].value === 'driver-employee-1', 'Partner Admin-approved active driver must unlock dependent selectors.');
  check(activeDashboard.staffDriverWorkflow.canPublishDeparture === true, 'An operational approved driver must unlock departure publication readiness.');
} finally {
  Module._load = originalModuleLoad;
}

if (!process.exitCode) console.log(`Staff and driver workflow verification passed (${passed}/${passed}).`);

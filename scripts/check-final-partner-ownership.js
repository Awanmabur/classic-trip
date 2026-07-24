'use strict';

const fs = require('fs');
const path = require('path');
let passed = 0;
function read(file) { return fs.readFileSync(path.join(process.cwd(), file), 'utf8'); }
function check(condition, message) {
  if (!condition) { console.error(`FAIL: ${message}`); process.exitCode = 1; }
  else passed += 1;
}

const adminRoutes = read('src/routes/web/admin.js');
const companyRoutes = read('src/routes/web/company.js');
const invitation = read('src/services/onboarding/invitationService.js');
const actions = read('src/services/dashboard/actionService.js');
const company = read('src/services/company/companyService.js');
const setup = read('src/modules/bus/services/busSetupService.js');
const busRepository = read('src/modules/bus/repositories/busRepository.js');
const verification = read('src/controllers/admin/verificationController.js');
const workspace = read('public/js/dashboard-workspace.js');
const staffView = read('src/views/dashboards/shared/sections/staff.ejs');
const css = read('public/css/accessibility.css');

check(!adminRoutes.includes('driver-requests/:id/approve'), 'Super Admin driver approval routes must be removed.');
check(!adminRoutes.includes('driver-requests/:id/reject'), 'Super Admin driver rejection routes must be removed.');
check(companyRoutes.includes("router.post('/company/drivers/:id/activate'"), 'Partner Admin must own driver status changes.');
check(invitation.includes("!['staff', 'driver'].includes(type)"), 'Partner Admin invitation flow must support staff and drivers.');
check(invitation.includes("company.driver_invitation.sent"), 'Direct Partner Admin driver invitation must be audited.');
check(actions.includes("source: 'company_staff'") || actions.includes("actorId, 'company_staff'"), 'Driver creation must use the direct company invitation path.');
check(actions.includes("approvalOwner: 'partner_admin'"), 'Driver creation audit must record Partner Admin ownership.');
check(company.includes("approvalOwner: 'partner_admin'"), 'Driver status changes must record Partner Admin ownership.');
check(company.includes('evaluateDriverAssignment(employee, user)'), 'Manual driver assignment must accept any configured company driver status.');
check(verification.includes('Driver and employee approval belongs to the Partner Admin'), 'Super Admin verification endpoints must refuse driver approval.');
check(setup.includes('chooseDriverForSchedule(drivers, schedule)'), 'Listing publication must resolve multiple drivers deterministically.');
check(!setup.includes('More than one driver is available'), 'Multiple drivers must not block listing publication.');
check(setup.includes('pendingScheduleId') && setup.includes('assignedFleetId'), 'Automatic driver selection must prefer explicit schedule and vehicle relationships.');
check(company.includes('schedule.listingId') && company.includes('schedule.routeId') && company.includes('schedule.vehicleId'), 'Bus departure ownership must resolve canonical listing, route, and vehicle links.');
check(busRepository.includes('function identityClauses'), 'Bus entities must accept app IDs and MongoDB ObjectIds.');
check(workspace.includes('Super Admin approves only the partner company'), 'Dashboard must explain final approval ownership.');
check(staffView.includes('Partner Admin creates, invites, activates, suspends, assigns'), 'Staff page must explain Partner Admin employee ownership.');
check(css.includes('color: #f8fafc !important') && css.includes('-webkit-text-fill-color: #f8fafc'), 'Dark mode must force readable light text without replacing page backgrounds.');
check(css.includes('font-size: 16px !important') && css.includes('--ct-mobile-control: 50px') && css.includes('--ct-mobile-button: 48px'), 'Previously accepted phone typography and control sizes must be restored.');

if (!process.exitCode) console.log(`Final partner ownership and visibility verification passed (${passed}/${passed}).`);

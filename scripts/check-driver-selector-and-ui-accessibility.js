'use strict';

const fs = require('fs');
const path = require('path');
let passed = 0;
function read(file) { return fs.readFileSync(path.join(process.cwd(), file), 'utf8'); }
function check(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else passed += 1;
}

const employeeModel = read('src/models/CompanyEmployee.js');
const actionService = read('src/services/dashboard/actionService.js');
const invitationService = read('src/services/onboarding/invitationService.js');
const departureService = read('src/modules/bus/services/busDepartureService.js');
const setupService = read('src/modules/bus/services/busSetupService.js');
const projection = read('src/services/dashboard/dashboardProjectionEngine.js');
const workspace = read('public/js/dashboard-workspace.js');
const accessibility = read('public/css/accessibility-safe.css');
const packageJson = JSON.parse(read('package.json'));
const siteHeader = read('public/js/site-header.js');
const homeJs = read('public/js/home.js');
const loginView = read('src/views/pages/auth/login.ejs');

check(employeeModel.includes("userId: { type: String, default: '', index: true }"), 'Driver requests must exist before account creation.');
check(employeeModel.includes('requestTicketId:'), 'Driver records must retain the request relationship.');
check(actionService.includes("status: 'requested'"), 'Saving a driver request must create a requested CompanyEmployee record.');
check(actionService.includes('driverEmployeeId: driverEmployee.id'), 'The support request must link to the canonical driver record.');
check(invitationService.includes('driverEmployeeId: cleanText(payload.driverEmployeeId'), 'Driver invitations must retain the canonical driver record link.');
check(invitationService.includes('employee.userId = user.id'), 'Invitation acceptance must attach the created account to the existing driver record.');
check(!departureService.includes('if (!employee) employee = await materializeDriverCandidate'), 'Pending requests and invitations must not materialize during departure assignment.');
check(departureService.includes('Select a saved driver record from this company'), 'An explicitly selected departure driver must be a saved company driver record.');
check(setupService.includes('Driver assignment is optional') && !setupService.includes('await assignableDrivers(companyId)'), 'Smart publication must not require or auto-assign a driver.');
check(projection.includes('const driverSelectorOptions = assignableDriverEmployees.map(driverOption)'), 'Dashboard selectors must expose all saved assignable company drivers.');
check(projection.includes('driverSelectorOptions'), 'One merged driver selector contract must exist.');
check(workspace.includes('Driver assignment is optional'), 'The UI must describe the optional assignment rule.');
check(workspace.includes('Any saved company driver can be selected'), 'The UI must explain that saved company drivers remain selectable.');
check(accessibility.includes(':focus-visible'), 'A keyboard focus accessibility layer must exist.');
check(accessibility.includes('prefers-reduced-motion: reduce'), 'Reduced-motion support must exist.');
check(accessibility.includes('forced-colors: active'), 'High-contrast forced-colours support must exist.');
check(!accessibility.includes('min-height:') && !accessibility.includes('border-radius:') && !accessibility.includes('grid-template-columns:'), 'Accessibility CSS must not alter approved UI geometry.');
check(!accessibility.includes('html[data-theme="dark"]') && !accessibility.includes('body {'), 'Accessibility CSS must not replace theme or page styling.');
check(siteHeader.includes("localStorage.getItem('classicTripTheme')"), 'Public pages must use the shared platform theme key.');
check(homeJs.includes("localStorage.getItem('classicTripTheme')"), 'Homepage must use the shared platform theme key.');
check(loginView.includes("localStorage.setItem('classicTripTheme'"), 'Authentication pages must use the shared platform theme key.');
check(packageJson.scripts['check:driver-ui'], 'The driver/UI regression gate must be registered.');

const viewRoot = path.join(process.cwd(), 'src/views');
const interactiveHeads = [];
function visit(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) visit(full);
    else if (entry.name.endsWith('.ejs')) {
      const content = fs.readFileSync(full, 'utf8');
      if (/<head(?:\s|>)/i.test(content)) interactiveHeads.push({ full, content });
    }
  });
}
visit(viewRoot);
check(interactiveHeads.every(({ content }) => content.includes('/css/accessibility-safe.css')), 'Every full HTML view must load the non-destructive accessibility layer.');

if (!process.exitCode) console.log(`Driver selector and UI accessibility verification passed (${passed}/${passed}).`);

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
const accessibility = read('public/css/accessibility.css');
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
check(departureService.includes('Select an active, verified driver account from this company'), 'Departure assignment must require an operational company driver.');
check(setupService.includes("employees.list({ companyId, status: 'active' }"), 'Smart publication must consider active employee memberships only.');
check(projection.includes('const driverSelectorOptions = activeDriverEmployees.map(driverOption)'), 'Dashboard selectors must expose operational drivers only.');
check(projection.includes('driverSelectorOptions'), 'One merged driver selector contract must exist.');
check(workspace.includes('Only active driver accounts with accepted membership'), 'The UI must describe the strict assignment rule.');
check(!workspace.includes('Any saved company driver can be assigned regardless'), 'Unsafe any-status driver copy must be absent.');
check(accessibility.includes('html[data-theme="dark"]'), 'A platform dark-mode accessibility layer must exist.');
check(accessibility.includes('--muted: #cbd5e1'), 'Dark-mode secondary text must have readable contrast.');
check(accessibility.includes('font-size: 16px !important'), 'Mobile form text must prevent tiny controls and browser zoom.');
check(accessibility.includes('min-height: var(--ct-mobile-button)'), 'Mobile buttons must use accessible touch targets.');
check(accessibility.includes('min-height: var(--ct-mobile-control)'), 'Mobile inputs must use accessible touch targets.');
check(accessibility.includes('.detailItem span') && accessibility.includes('.row span'), 'Dark-mode secondary data labels must be explicitly readable.');
check(!accessibility.includes('background-color: var(--input, #111827) !important'), 'Dark-mode contrast fixes must not replace the existing field background.');
check(accessibility.includes('-webkit-text-fill-color: #f8fafc'), 'Dark-mode fields must use readable light text without changing their backgrounds.');
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
check(interactiveHeads.every(({ content }) => content.includes('/css/accessibility.css')), 'Every full HTML view must load the accessibility layer last.');

if (!process.exitCode) console.log(`Driver selector and UI accessibility verification passed (${passed}/${passed}).`);

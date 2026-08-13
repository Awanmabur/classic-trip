'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const checks = [];
function check(name, condition) {
  checks.push({ name, ok: Boolean(condition) });
  if (!condition) console.error(`FAIL: ${name}`);
}

const workspace = read('src/views/dashboards/shared/workspace.ejs');
const schedules = read('src/views/dashboards/shared/sections/schedules.ejs');
const dynamicService = read('src/views/dashboards/shared/sections/dynamic-service.ejs');
const css = read('public/css/completion-fixes.css');
const login = read('src/views/pages/auth/login.ejs');
const mfaChallenge = read('src/views/pages/auth/mfa-challenge.ejs');
const mfaSetup = read('src/views/pages/auth/mfa-setup.ejs');
const pageActions = read('public/js/page-actions.js');
const home = read('src/views/pages/home.ejs');
const companies = read('src/views/pages/companies.ejs');
const promoters = read('src/views/pages/promoters.ejs');
const support = read('src/views/pages/support.ejs');
const footer = read('src/views/partials/site-footer-markup.ejs');

check('Overview uses stable dashboard flow page', workspace.includes('dashboardFlowPage dashboardOverviewPage'));
check('Schedule uses stable dashboard flow page', schedules.includes('dashboardFlowPage dashboardSchedulePage'));
check('All service category pages use stable service page shell', dynamicService.includes('dashboardFlowPage serviceDashboardPage'));
check('Stable flow page is a one-column grid', css.includes('.dashboardBody .dashboardFlowPage.is-open') && css.includes('grid-template-columns:minmax(0,1fr)!important'));
check('Stable flow children cannot float or overlap', css.includes('float:none!important') && css.includes('clear:both!important') && css.includes('transform:none!important'));
check('Phone overview cards use explicit responsive grid', css.includes('.dashboardBody .dashboardOverviewPage .statsGrid'));
check('Phone schedule actions use responsive grid', css.includes('.dashboardBody .dashboardSchedulePage .rowActions'));
check('Phone service category cards collapse to one column', css.includes('.dashboardBody .serviceDashboardPage>.grid2'));
check('Login loads shared page actions', login.includes('/js/page-actions.js'));
check('Login flash messages are dismissible', login.includes('data-site-flash') && login.includes('data-dismiss-site-flash'));
check('Shared dismiss handler uses delegated click handling', pageActions.includes("closest('[data-dismiss-site-flash]')"));
check('MFA challenge does not duplicate flash rendering', !mfaChallenge.includes('flashMessages.forEach'));
check('MFA setup does not duplicate flash rendering', !mfaSetup.includes('flashMessages.forEach'));
check('Homepage loads dismiss handler', home.includes('/js/page-actions.js'));
check('Homepage uses persuasive positioning', home.includes('Move, stay and fly') && home.includes('travel platform'));
check('Partner directory uses professional positioning', companies.includes('trust, service and regional reach'));
check('Promoter page uses professional positioning', promoters.includes('transparent earnings'));
check('Support page uses professional positioning', support.includes('Reliable support before, during and after every journey'));
check('Footer presents a trusted four-service experience', footer.includes('one secure, transparent booking experience'));
check('Super Admin overview uses command-centre wording', workspace.includes('one trusted command centre'));

const failures = checks.filter((item) => !item.ok);
if (failures.length) {
  console.error(`Final Super Admin/flash/copy audit failed (${checks.length - failures.length}/${checks.length}).`);
  process.exit(1);
}
console.log(`Final Super Admin/flash/copy audit passed (${checks.length}/${checks.length}).`);

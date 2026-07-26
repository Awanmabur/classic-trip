'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
let passed = 0;
function check(condition, message) { if (!condition) throw new Error(`FAIL: ${message}`); passed += 1; }

const css = read('public/css/completion-fixes.css');
const siteHead = read('src/views/partials/site-head.ejs');
const home = read('src/views/pages/home.ejs');
const dashboard = read('src/views/dashboards/shared/workspace.ejs');
const login = read('src/views/pages/auth/login.ejs');
const auth = read('src/controllers/auth/authController.js');
const pageActions = read('public/js/page-actions.js');
const flashPartial = read('src/views/partials/site-flash.ejs');

[
  '.dashboardBody .app',
  'width:calc(100% - 12px)',
  '.dashboardBody .section.is-open{display:grid;gap:10px',
  '.sitePage .gridCards,.sitePage .detailGrid{grid-template-columns:1fr!important',
  '.homePage .marketplaceEmptyCard',
  '.authPage .panel.active{display:grid;gap:14px',
  '.siteFlashStack',
].forEach((fragment) => check(css.includes(fragment), `Completion stylesheet includes ${fragment}`));
check(siteHead.includes('/css/completion-fixes.css') && siteHead.includes("include('site-flash')"), 'Shared public shell loads completion CSS and flash');
check(home.includes('/css/completion-fixes.css') && home.includes("include('../partials/site-flash')"), 'Homepage loads completion CSS and flash');
check(dashboard.includes('class="dashboardBody"') && dashboard.includes('/css/completion-fixes.css'), 'Dashboard is scoped to completion fixes');
check(login.includes('class="authPage"') && login.includes('/css/completion-fixes.css'), 'Auth page is scoped to completion fixes');
check(flashPartial.includes('data-site-flash-stack') && flashPartial.includes('data-dismiss-site-flash'), 'Public flash partial is dismissible');
check(pageActions.includes('dismissSiteFlash') && pageActions.includes("[data-site-flash-stack]"), 'Public flash messages auto-dismiss safely');
check(auth.includes("req.session.regenerate") && auth.includes('signed out securely'), 'Logout rotates the session and preserves user feedback');
check(auth.includes('Password reset instructions were sent') && auth.includes('Password reset completed'), 'Password recovery actions provide flash feedback');
for (const file of [
  'src/views/pages/auth/phone-verification.ejs',
  'src/views/pages/auth/reset-password.ejs',
  'src/views/pages/invite-accept.ejs',
]) {
  const source = read(file);
  check(source.includes('site-flash') && source.includes('/js/page-actions.js'), `${file} renders and dismisses flash feedback`);
}

check(!/(^|})\s*(body|html|\.sidebar|\.nav|\.card|\.btn)\s*\{/m.test(css), 'Completion CSS does not globally redesign the approved UI');
console.log(`Final spacing, stacking and flash checks passed (${passed}/${passed}).`);


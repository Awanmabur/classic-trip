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
  return new Function('locals', 'include', `with (locals || {}) { ${generated} }`);
}

function renderTemplate(relative, locals) {
  const filename = path.join(root, relative);
  const template = fs.readFileSync(filename, 'utf8');
  const render = compileTemplate(template, filename);
  const include = (request, data = {}) => {
    const includeFile = path.resolve(path.dirname(filename), request.endsWith('.ejs') ? request : `${request}.ejs`);
    const includeRelative = path.relative(root, includeFile);
    return renderTemplate(includeRelative, Object.assign({}, locals, data));
  };
  return render(locals, include);
}

const dynamicService = read('src/views/dashboards/shared/sections/dynamic-service.ejs');
const workspace = read('src/views/dashboards/shared/workspace.ejs');
const adminControls = read('src/views/dashboards/shared/sections/admin-travel-supply-controls.ejs');
const driverLocation = read('src/models/DriverLocation.js');
const db = read('src/config/db.js');
const siteHead = read('src/views/partials/site-head.ejs');
const companies = read('src/views/pages/companies.ejs');
const partnerCommission = read('src/views/pages/partner-commission.ejs');
const referencePublic = read('public/css/pages/home.css');
const publicAdditions = read('public/css/four-service-ui.css');
const referenceDashboard = read('public/css/dashboard-workspace.css');
const dashboardAdditions = read('public/css/dashboard-service-additions.css');
const authView = read('src/views/pages/auth/login.ejs');

expect('Nested dynamic service include does not reference unavailable sectionLocals', !dynamicService.includes('Object.assign({}, sectionLocals'));
expect('Nested admin controls receive explicit dashboard locals', dynamicService.includes("{ service, dashboardData, platformConfig, csrfToken, cspNonce }"));
expect('Admin travel controls use only explicit shared locals', ['service', 'dashboardData', 'platformConfig', 'csrfToken', 'cspNonce'].every((name) => adminControls.includes(name)));
expect('Dashboard workspace loads the approved reference stylesheet and scoped service additions', workspace.includes('/css/dashboard-workspace.css') && workspace.includes('/css/dashboard-service-additions.css'));
expect('Public pages load the approved reference styles and scoped four-service additions', siteHead.includes('/css/pages/home.css') && siteHead.includes('/css/four-service-ui.css'));
expect('Standalone auth pages retain their approved local visual systems', ['login.ejs','phone-verification.ejs','reset-password.ejs'].every((name) => read(`src/views/pages/auth/${name}`).includes('<style>')));
expect('Partners banner has explicit spacing hook', companies.includes('partnersDirectoryBanner'));
expect('Partners banner receives bottom margin', /\.partnersDirectoryBanner\s*\{[^}]*margin-bottom:/s.test(publicAdditions));
expect('Partner commission page uses shared marketing layout', partnerCommission.includes('marketingPage partnerCommissionPage'));
expect('Marketplace actions remain two-column View and Book layout', publicAdditions.includes('.partnerCardActions') && publicAdditions.includes('grid-template-columns:repeat(2,minmax(0,1fr))'));
expect('Public controls preserve the approved pill geometry', referencePublic.includes('.control{') && referencePublic.includes('min-height:38px') && referencePublic.includes('border-radius:999px'));
expect('Dashboard forms preserve the approved geometry', referenceDashboard.includes('.control{min-height:43px') && referenceDashboard.includes('border-radius:18px'));
expect('Dashboard service additions are scoped instead of redefining the whole shell', dashboardAdditions.includes('.adminSupplyControl') && !dashboardAdditions.includes('.main{'));
expect('Auth forms retain approved gaps and rounded controls', authView.includes('.form.active{display:grid;gap:11px}') && authView.includes('border-radius:999px'));
expect('DriverLocation TTL index is declared only once', !/expiresAt:\s*\{[^}]*index:\s*true/.test(driverLocation) && (driverLocation.match(/index\(\{\s*expiresAt:\s*1\s*\}/g) || []).length === 1);
expect('Mongo connection defaults to classic-trip when URI omits database', db.includes("uriIncludesDatabaseName") && db.includes("'classic-trip'"));


try {
  const baseLocals = {
    dashboardRoleKey: 'admin',
    service: { key: 'flight-service', serviceType: 'flight', label: 'Flights', status: 'production', overview: 'Agent-supported flights', modules: [], features: [] },
    dashboardData: { travelSupply: { flight: {}, mobility: {} } },
    platformConfig: { defaultCurrency: 'UGX', supportedCurrencies: ['UGX', 'KES'] },
    csrfToken: 'test-csrf',
    cspNonce: 'test-nonce',
  };
  const flightHtml = renderTemplate('src/views/dashboards/shared/sections/dynamic-service.ejs', baseLocals);
  const mobilityHtml = renderTemplate('src/views/dashboards/shared/sections/dynamic-service.ejs', Object.assign({}, baseLocals, {
    service: { key: 'mobility-service', serviceType: 'local_transport', label: 'Local mobility', status: 'production', overview: 'Safe local rides', modules: [], features: [] },
  }));
  expect('Admin flight dynamic service renders through nested include', flightHtml.includes('Platform flight supply'));
  expect('Admin mobility dynamic service renders through nested include', mobilityHtml.includes('Platform-owned mobility controls'));
} catch (error) {
  expect(`Admin dynamic service render smoke: ${error.message}`, false);
}

if (failures.length) {
  console.error(`Full platform layout/admin validation failed (${checks.length - failures.length}/${checks.length}).`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Full platform layout/admin validation passed (${checks.length}/${checks.length}).`);

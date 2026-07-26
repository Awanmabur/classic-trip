'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
  const rel = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(rel) : [rel];
});
const failures = [];
const passed = [];
function check(name, condition, detail = '') {
  if (condition) passed.push(name);
  else failures.push(`${name}${detail ? `: ${detail}` : ''}`);
}

const crypto = require('crypto');
const fileHash = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
const approvedUi = {
  'public/css/base.css': '653530243e926bc64e4cb2e733066dcb18586af8baa86ff8d8351701ab976ca5',
  'public/css/components.css': 'd6d52392225dd6c931954ae51cd658dc27f94601de35b025ae59b4b1a50e3965',
  'public/css/dashboard-workspace.css': '68c5a5b6e4b90fb4153430a043e64724865ddc9ca3d283386c366eb9f3865ab5',
  'public/css/pages/home.css': 'ff27c53a35e6e00743f03e0d08825fb0f8c2f3fe56fe446d560126d2e8d2936d',
};
Object.entries(approvedUi).forEach(([file, expected]) => check(`${file} matches the uploaded approved UI`, fileHash(file) === expected));
const travelCss = read('public/css/pages/travel-booking.css');
const publicAdditions = read('public/css/four-service-ui.css');
const dashboardAdditions = read('public/css/dashboard-service-additions.css');
[
  '.travelControl',
  'border-radius:999px',
  '@media(max-width:680px)',
  '.liveMap',
].forEach((fragment) => check(`Scoped travel contract includes ${fragment}`, travelCss.includes(fragment) || dashboardAdditions.includes(fragment)));
check('Public final-only UI is scoped', publicAdditions.includes('.partnersDirectoryPage') && publicAdditions.includes('.supportPage') && !publicAdditions.includes('body{'));
check('Dashboard final-only UI is scoped', dashboardAdditions.includes('.adminSupplyControl') && dashboardAdditions.includes('.hotelSetupJourney') && !dashboardAdditions.includes('.sidebar{'));
const forbiddenUi = ['accessibility.css','platform-layout-polish.css','final-system-audit.css','dashboard-final-polish.css','auth-layout-polish.css','production-ui-lock.css'];
const shellViews = [
  'src/views/partials/site-head.ejs',
  'src/views/pages/home.ejs',
  'src/views/dashboards/shared/workspace.ejs',
  'src/views/pages/auth/login.ejs',
  'src/views/pages/auth/phone-verification.ejs',
  'src/views/pages/auth/reset-password.ejs',
  'src/views/pages/invite-accept.ejs',
];
shellViews.forEach((file) => check(`${file} has no destructive global override`, !forbiddenUi.some((name) => read(file).includes(name))));
check('Public shell loads scoped four-service additions', read('src/views/partials/site-head.ejs').includes('/css/four-service-ui.css'));
check('Dashboard shell loads scoped service additions', read('src/views/dashboards/shared/workspace.ejs').includes('/css/dashboard-service-additions.css'));

const viewFiles = walk('src/views').filter((file) => file.endsWith('.ejs'));
const inlineSizing = [];
for (const file of viewFiles) {
  const source = read(file);
  const matches = source.match(/<(input|select|textarea|button)\b[^>]*\bstyle="[^"]*(height|min-height|border-radius)[^"]*"/gi) || [];
  if (matches.length) inlineSizing.push(`${file} (${matches.length})`);
}
check('Form controls do not carry conflicting inline size/radius styles', inlineSizing.length === 0, inlineSizing.join(', '));

const standalone = viewFiles.filter((file) => /<!doctype html/i.test(read(file)));
standalone.forEach((file) => check(`${file} declares a responsive viewport`, /name="viewport"[^>]*width=device-width/i.test(read(file))));

const tableFiles = viewFiles.filter((file) => /<table\b/i.test(read(file)));
const uncontainedTables = [];
for (const file of tableFiles) {
  const source = read(file);
  const tableCount = (source.match(/<table\b/gi) || []).length;
  const wrappers = (source.match(/class="[^"]*(?:tableWrap|tableScroll|hotelManifestTableWrap)[^"]*"/gi) || []).length;
  if (wrappers < tableCount) uncontainedTables.push(`${file} (${tableCount} tables/${wrappers} wrappers)`);
}
check('Every rendered table is contained by an internal scroller', uncontainedTables.length === 0, uncontainedTables.join(', '));

const serviceRegistry = read('src/config/serviceRegistry.js');
['bus','hotel','flight','local_transport'].forEach((key) => check(`${key} is an active bookable service`, new RegExp(`${key}:[\\s\\S]*status: 'active'[\\s\\S]*bookable: true`).test(serviceRegistry)));

const app = read('src/app.js');
[
  "app.disable('x-powered-by')",
  'crypto.randomUUID()',
  "res.setHeader('X-Request-ID'",
  'helmet({',
  'contentSecurityPolicy',
  'csrfToken',
  'compression()',
  "express.json({ limit: '2mb'",
  "app.use('/api/webhooks'",
].forEach((fragment) => check(`Application security/config includes ${fragment}`, app.includes(fragment)));

const securityFiles = {
  'src/config/session.js': ['httpOnly: true', "sameSite: 'lax'", 'secure: env.isProduction', 'connect-mongo'],
  'src/middlewares/rateLimit.js': ['passOnStoreError: false', 'authLimiter', 'paymentLimiter', 'publicWriteLimiter'],
  'src/middlewares/csrf.js': ['timingSafeEqual', 'isSameOriginRequest', 'requireCsrfToken'],
  'src/services/media/uploadService.js': ['assertFileSignature', 'detectedMimeType', 'File content does not match'],
};
for (const [file, fragments] of Object.entries(securityFiles)) {
  const source = read(file);
  fragments.forEach((fragment) => check(`${file} includes ${fragment}`, source.includes(fragment)));
}

const publicRoutes = read('src/routes/web/public.js');
['/flights','/taxi','/services','/support'].forEach((route) => check(`Public route surface includes ${route}`, publicRoutes.includes(route)));
check('Readiness endpoint verifies MongoDB state', publicRoutes.includes("router.get('/ready'") && publicRoutes.includes('mongoose.connection.readyState === 1'));
const server = read('src/server.js');
['SIGTERM', 'SIGINT', 'Graceful shutdown started', 'mongoose.disconnect()', 'keepAliveTimeout', 'headersTimeout'].forEach((fragment) => check(`Server lifecycle includes ${fragment}`, server.includes(fragment)));

const packageJson = JSON.parse(read('package.json'));
check('Production readiness gate is wired into verify', String(packageJson.scripts.verify || '').includes('check:production-readiness-final'));
check('Release guide is current', fs.existsSync(path.join(root, 'RELEASE_NOTES_2026-07-26.md')) && fs.existsSync(path.join(root, 'README.md')));

if (failures.length) {
  console.error(`Production readiness final audit failed (${passed.length}/${passed.length + failures.length}).`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(`Production readiness final audit passed (${passed.length}/${passed.length}).`);

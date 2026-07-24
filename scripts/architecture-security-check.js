const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const failures = [];

function walk(directory, extensions = null) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(fullPath, extensions);
    if (!extensions || extensions.some((extension) => entry.name.endsWith(extension))) return [fullPath];
    return [];
  });
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, '/');
}

function fail(message) {
  failures.push(message);
}

const sourceFiles = walk(path.join(root, 'src'), ['.js', '.ejs']);
const publicScripts = walk(path.join(root, 'public', 'js'), ['.js']);
const runtimeFiles = [...sourceFiles, ...publicScripts];

for (const file of runtimeFiles) {
  const name = relative(file);
  const source = fs.readFileSync(file, 'utf8');
  if (/persistentStore/i.test(source)) fail(`${name}: legacy persistentStore reference is forbidden`);
  if (/\bstore\.state\b/.test(source)) fail(`${name}: direct mutable store.state access is forbidden`);
  if (/require\(['"][^'"]*memoryDatabase['"]\)/.test(source)) fail(`${name}: runtime memoryDatabase imports are forbidden`);
  if (name.endsWith('.ejs') && /\son[a-z]+\s*=/i.test(source)) fail(`${name}: inline event attributes violate strict CSP`);
  if (/\beval\s*\(|new\s+Function\s*\(/.test(source)) fail(`${name}: dynamic code execution is forbidden`);
  if (/child_process/.test(source) && !name.startsWith('scripts/')) fail(`${name}: child_process is forbidden in runtime code`);
}

const appSource = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const scriptSrcDirective = appSource.match(/scriptSrc:\s*\[([^\]]*)\]/)?.[1] || '';
if (scriptSrcDirective.includes("'unsafe-inline'")) fail('src/app.js: script-src must not allow unsafe-inline');
if (!/scriptSrcAttr:\s*\["'none'"\]/.test(appSource)) fail("src/app.js: script-src-attr must be 'none'");
if (!/crypto\.randomBytes\(/.test(appSource) || !/nonce-\$\{res\.locals\.cspNonce\}/.test(appSource)) fail('src/app.js: per-request CSP nonces are required');
if (!/res\.redirect\(308, `\$\{publicOrigin\}\$\{req\.originalUrl\}`\)/.test(appSource) || !/new URL\(env\.appUrl\)\.origin/.test(appSource)) fail('src/app.js: host-header-safe production HTTPS enforcement is required');

const rateLimitSource = fs.readFileSync(path.join(root, 'src', 'middlewares', 'rateLimit.js'), 'utf8');
if (!/MongoRateLimitStore/.test(rateLimitSource) || !/passOnStoreError:\s*false/.test(rateLimitSource)) fail('src/middlewares/rateLimit.js: production rate limits must be distributed and fail closed');
const referralSource = fs.readFileSync(path.join(root, 'src', 'middlewares', 'referral.js'), 'utf8');
if (!/normalizeReferralCode/.test(referralSource) || !/httpOnly:\s*true/.test(referralSource)) fail('src/middlewares/referral.js: referral cookies and codes must be hardened');
const uploadSource = fs.readFileSync(path.join(root, 'src', 'services', 'media', 'uploadService.js'), 'utf8');
if (!/assertFileSignature/.test(uploadSource)) fail('src/services/media/uploadService.js: upload content signatures must be validated');

const dbSource = fs.readFileSync(path.join(root, 'src', 'config', 'db.js'), 'utf8');
if (!/command\(\{ hello: 1 \}\)/.test(dbSource) || !/setName/.test(dbSource) || !/isdbgrid/.test(dbSource)) {
  fail('src/config/db.js: transaction-capable replica set or mongos verification is required');
}
const unitOfWorkSource = fs.readFileSync(path.join(root, 'src', 'services', 'shared', 'mongoUnitOfWork.js'), 'utf8');
if (!/MONGO_TRANSACTIONS=true is required in production/.test(unitOfWorkSource) || !/writeConcern: \{ w: 'majority' \}/.test(unitOfWorkSource)) {
  fail('src/services/shared/mongoUnitOfWork.js: production units of work must fail closed with majority transactions');
}

const sessionSource = fs.readFileSync(path.join(root, 'src', 'config', 'session.js'), 'utf8');
if (!/secure:\s*env\.isProduction/.test(sessionSource)) fail('src/config/session.js: production session cookies must be Secure');
if (!/httpOnly:\s*true/.test(sessionSource)) fail('src/config/session.js: session cookies must be HttpOnly');
if (!/sameSite:\s*'lax'/.test(sessionSource)) fail('src/config/session.js: SameSite protection is required');

const csrfSource = fs.readFileSync(path.join(root, 'src', 'middlewares', 'csrf.js'), 'utf8');
if (/req\.query\??\._csrf/.test(csrfSource)) fail('src/middlewares/csrf.js: CSRF tokens must never be accepted from query strings');
if (!/timingSafeEqual/.test(csrfSource)) fail('src/middlewares/csrf.js: constant-time CSRF comparison is required');


const routeModelSource = fs.readFileSync(path.join(root, 'src', 'models', 'Route.js'), 'utf8');
if (/\bstops\s*:/.test(routeModelSource)) fail('src/models/Route.js: embedded route stops are forbidden; RouteStop is canonical');
const vehicleModelSource = fs.readFileSync(path.join(root, 'src', 'models', 'Vehicle.js'), 'utf8');
if (!/\bseatTemplate\s*:/.test(vehicleModelSource)) fail('src/models/Vehicle.js: canonical seatTemplate is required');
if (/^\s*seats\s*:/m.test(vehicleModelSource)) fail('src/models/Vehicle.js: persisted seats are forbidden; use seatTemplate');
const bookingModelSource = fs.readFileSync(path.join(root, 'src', 'models', 'Booking.js'), 'utf8');
if (!/require\(['"]\.\.\/domain\/statuses['"]\)/.test(bookingModelSource) || !/enum:\s*BOOKING_STATUSES/.test(bookingModelSource)) {
  fail('src/models/Booking.js: canonical booking statuses must be imported and enforced');
}
if (!/passengers:\s*\[passengerSnapshotSchema\]/.test(bookingModelSource)) fail('src/models/Booking.js: typed immutable passenger snapshots are required');
const seatModelSource = fs.readFileSync(path.join(root, 'src', 'models', 'Seat.js'), 'utf8');
if (/checked-in|no-show/.test(seatModelSource)) fail('src/models/Seat.js: hyphenated legacy seat statuses are forbidden');
if (!/checked_in/.test(seatModelSource) || !/no_show/.test(seatModelSource)) fail('src/models/Seat.js: canonical checked_in and no_show states are required');
const routeAuditPath = path.join(root, 'scripts', 'route-security-audit.js');
if (!fs.existsSync(routeAuditPath)) fail('scripts/route-security-audit.js: route security build gate is required');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (!String(packageJson.scripts?.verify || '').includes('check:routes')) fail('package.json: verify must execute the route-security gate');
if (!String(packageJson.scripts?.check || '').includes('check-syntax.js')) fail('package.json: check must execute syntax and model-load validation');

const workspacePath = path.join(root, 'src', 'views', 'dashboards', 'shared', 'workspace.ejs');
const workspaceBytes = fs.statSync(workspacePath).size;
if (workspaceBytes > 60_000) fail(`Dashboard workspace remains oversized (${workspaceBytes} bytes)`);
const sectionFiles = walk(path.join(root, 'src', 'views', 'dashboards', 'shared', 'sections'), ['.ejs']);
if (sectionFiles.length < 40) fail('Dashboard must be decomposed into focused role/domain sections');

const forbiddenArtifacts = ['.env', '.git', 'coverage', '.nyc_output'];
for (const artifact of forbiddenArtifacts) {
  if (fs.existsSync(path.join(root, artifact))) fail(`Release workspace contains forbidden artifact: ${artifact}`);
}

const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
const suspiciousAssignedSecrets = envExample.split(/\r?\n/).filter((line) => {
  if (!line || line.startsWith('#')) return false;
  const [key, ...rest] = line.split('=');
  if (!/(SECRET|PASSWORD|PRIVATE|TOKEN|API_KEY)/i.test(key || '')) return false;
  const value = rest.join('=').trim();
  return value && !/^(change|replace|your|example|test|development|<)/i.test(value);
});
if (suspiciousAssignedSecrets.length) fail('.env.example appears to contain populated secret values');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Architecture/security validation passed (${sectionFiles.length} dashboard sections, ${workspaceBytes} byte workspace).`);

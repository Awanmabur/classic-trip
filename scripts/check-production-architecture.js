'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const failures = [];
let checks = 0;

function check(condition, message) {
  checks += 1;
  if (!condition) failures.push(message);
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function source(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

const forbiddenPaths = [
  '.env', '.claude', 'node_modules', 'coverage',
  'src/repositories/memoryDatabase.js',
  'src/services/data/persistentStore.js',
  'src/repositories/domain/hybridCollection.js',
  'src/services/payment/mockPaymentProvider.js',
  'src/services/implementation',
  'src/controllers/admin/masterImplementationController.js',
];
for (const item of forbiddenPaths) check(!fs.existsSync(path.join(root, item)), `Forbidden release artifact remains: ${item}`);
const rootReports = fs.readdirSync(root).filter((name) => /(?:HOTFIX|IMPLEMENTATION_REPORT|RECOVERY|VISIBILITY_FIX|PERSISTENCE_FIX|SMART_BUS_FORMS)/i.test(name));
check(rootReports.length === 0, `Historical patch reports must not ship: ${rootReports.join(', ')}`);

const seedFiles = walk(path.join(root, 'src', 'seeds')).filter((file) => file.endsWith('.js')).map((file) => path.basename(file));
check(seedFiles.length === 1 && seedFiles[0] === 'seedSuperAdmin.js', `Only seedSuperAdmin.js may ship; found ${seedFiles.join(', ')}`);

const packageJson = JSON.parse(source('package.json'));
const scripts = packageJson.scripts || {};
check(scripts.seed === 'node src/seeds/seedSuperAdmin.js', 'npm run seed must create only the Super Admin');
check(!Object.keys(scripts).some((name) => /^(repair|seed:local|dev:seeded|acceptance)/.test(name)), 'Repair, demo-seed, and acceptance commands must not ship as production scripts');
check(String(scripts.verify || '').includes('check:production'), 'npm run verify must include production architecture validation');

const runtimeFiles = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'public', 'js'))]
  .filter((file) => /\.(js|ejs)$/.test(file));
const forbiddenRuntimePatterns = [
  [/memoryDatabase/, 'memoryDatabase'],
  [/persistentStore/, 'persistentStore'],
  [/HybridCollection/, 'HybridCollection'],
  [/mockPaymentProvider/, 'mockPaymentProvider'],
  [/AUTO_SEED_MONGO|SEED_FRESH|DEMO_PASSWORD|ALLOW_MOCK|ALLOW_DEMO/, 'demo/automatic seed environment flags'],
  [/mirrorSave|mirrorMany|mirrorPosition/, 'dual-write mirror functions'],
  [/\.isMongoReady\(/, 'runtime Mongo availability branch'],
  [/skipPersistence|alreadyPersistedInTransaction/, 'persistence bypass flag'],
  [/Public · schedule pending/, 'public-without-departure status'],
  [/\b(?:flight|train|tour|cargo|car[_ -]?rental|ferry|loyalty)\b/i, 'unsupported service shell'],
];
const comingSoonDefinitionFiles = new Set(['src/config/serviceRegistry.js', 'src/views/pages/services.ejs']);
for (const file of runtimeFiles) {
  const text = fs.readFileSync(file, 'utf8');
  const relative = path.relative(root, file).replace(/\\/g, '/');
  for (const [pattern, label] of forbiddenRuntimePatterns) {
    if (label === 'unsupported service shell' && comingSoonDefinitionFiles.has(relative)) continue;
    check(!pattern.test(text), `${relative} still contains ${label}`);
  }
}
const serviceRegistry = source('src/config/serviceRegistry.js');
check(/bus:.*status:\s*'active'/s.test(serviceRegistry) && /hotel:.*status:\s*'active'/s.test(serviceRegistry), 'Bus and hotel must remain operational');
check(/flight:.*status:\s*'coming_soon'/s.test(serviceRegistry) && /local_transport:.*status:\s*'coming_soon'/s.test(serviceRegistry), 'Future services must remain explicitly coming soon');

const currencyAllowed = new Set(['src/models/PlatformSetting.js', 'src/services/platform/platformConfigService.js']);
for (const file of runtimeFiles) {
  const relative = path.relative(root, file).replace(/\\/g, '/');
  const text = fs.readFileSync(file, 'utf8');
  if (!currencyAllowed.has(relative)) check(!/['"]UGX['"]/.test(text), `${relative} embeds a currency instead of using Platform Settings`);
  if (relative.startsWith('src/models/') && relative !== 'src/models/PlatformSetting.js') {
    check(!/default:\s*platformCurrency/.test(text), `${relative} silently defaults an operational currency`);
    check(!/require\(['"]\.\.\/utils\/currency['"]\)/.test(text), `${relative} must receive inherited currency explicitly`);
  }
}
check(!/seed_opening_balance/.test(source('src/models/WalletTransaction.js')), 'Seed-only wallet transaction types must not ship');
check(!/seed_low_risk/.test(source('src/models/FraudSignal.js')), 'Seed-only fraud signal types must not ship');

const cloudinary = source('src/services/media/cloudinaryService.js');
check(!/classic-trip-dev|devAsset|fallback:\s*true/.test(cloudinary), 'Media service must not generate fake upload URLs');
check(/MEDIA_PROVIDER_NOT_CONFIGURED/.test(cloudinary), 'Media service must fail clearly when storage is not configured');

const server = source('src/server.js');
check(!/seedSuperAdmin|maybeBootstrapSuperAdmin|AUTO_SEED/.test(server), 'Server startup must not seed users automatically');
check(/ensurePlatformConfig/.test(server), 'Server must initialize the single platform configuration record');
const platformSettingModel = source('src/models/PlatformSetting.js');
const platformRootSchema = platformSettingModel.slice(platformSettingModel.indexOf('const platformSettingSchema'));
check((platformRootSchema.match(/defaultCurrency\s*:/g) || []).length === 0, 'Default currency must exist only inside financeRules');
check((platformRootSchema.match(/partnerCommissionPercent\s*:/g) || []).length === 0, 'Partner commission must exist only inside financeRules');
check((platformRootSchema.match(/promoterDefaultPercent\s*:/g) || []).length === 0, 'Promoter commission must exist only inside financeRules');

const roomReservation = source('src/services/booking/roomReservationService.js');
check(!/reservations\s*=\s*\[\]/.test(roomReservation), 'Room reservations must not use process memory');
const seatLocks = source('src/services/booking/seatLockService.js');
check(/InventoryHold/.test(seatLocks) || /inventoryHoldService/.test(seatLocks), 'Seat locks must be database backed');


check(!fs.existsSync(path.join(root, 'docs')), 'Historical reports and generated documentation must not ship inside the application');
check(!fs.existsSync(path.join(root, 'src', 'controllers', 'company', 'roomController.js')), 'Duplicate legacy hotel room controller must not ship');

const catalogSource = source('src/services/marketplace/catalogService.js');
const publicCompanyBlock = catalogSource.slice(catalogSource.indexOf('function publicCompany'), catalogSource.indexOf('function publicRoute'));
check(!/\.\.\.company/.test(publicCompanyBlock), 'Public company projection must use an allowlist rather than spreading private fields');
check(!/documents|wallet|referral|payout|taxNumber/.test(publicCompanyBlock), 'Public company projection must not expose private operational or financial fields');
const catalogItemBlock = catalogSource.slice(catalogSource.indexOf('function catalogItem'), catalogSource.indexOf('function publicCompany'));
check(!/\.\.\.listing/.test(catalogItemBlock), 'Public listing projection must use an allowlist rather than spreading database records');
const homeBootstrapBlock = catalogSource.slice(catalogSource.indexOf('async function homeBootstrap'), catalogSource.indexOf('async function recordReferralClick'));
check(!/\b(?:bookings|users|wallets)\s*:/.test(homeBootstrapBlock), 'Homepage bootstrap must not expose customer, booking, or wallet collections');

const busSetupSource = source('src/modules/bus/services/busSetupService.js');
check(/Publish at least one dated departure/.test(busSetupSource), 'Strict bus activation must require a published dated departure');
check(/listingId:\s*listingKey/.test(busSetupSource) && /schedule\.listingId/.test(busSetupSource), 'Bus activation must validate the exact listing-to-departure relationship');
check(/Select an active operating branch or terminal/.test(busSetupSource), 'Bus listings must inherit location from a real active branch');

if (failures.length) {
  console.error(`Production architecture validation failed (${failures.length}/${checks}):`);
  failures.forEach((failure, index) => console.error(`${index + 1}. ${failure}`));
  process.exit(1);
}
console.log(`Production architecture validation passed (${checks}/${checks}).`);

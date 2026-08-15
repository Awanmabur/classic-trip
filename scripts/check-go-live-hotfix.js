'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const pkg = JSON.parse(read('package.json'));
const checks = [];
function check(label, fn) { try { fn(); checks.push(label); console.log(`✓ ${label}`); } catch (e) { console.error(`✗ ${label} — ${e.message}`); process.exitCode = 1; } }
check('release is v1.6.85', () => assert.strictEqual(pkg.version, '1.6.85'));
check('Dandy uses bundled real image as canonical runtime media', () => {
  const seed = read('scripts/seed-launch-stays.js');
  const block = seed.slice(seed.indexOf("key: 'dandy-hotel'"), seed.indexOf("key: 'zoom-future-hotel'"));
  assert(block.includes("image: '/images/stays/dandy-hotel-real.jpg'"));
  assert(!block.includes('imageSource:'), 'Dandy must not be rewritten to a hot-linked image');
  const img = fs.readFileSync(path.join(root, 'public/images/stays/dandy-hotel-real.jpg'));
  assert(img.length > 10000 && img[0] === 0xff && img[1] === 0xd8 && img[2] === 0xff);
  const catalog = read('src/services/marketplace/catalogService.js');
  assert(catalog.includes("'dandy-hotel': '/images/stays/dandy-hotel-real.jpg'"));
  assert(catalog.includes("'daddy-hotel': '/images/stays/dandy-hotel-real.jpg'"));
  assert(catalog.includes('const seedOwned = !media.length || media.every'));
});
check('internal Mongo operators remain valid while HTTP operator injection stays blocked', () => {
  const db = read('src/config/db.js');
  const app = read('src/app.js');
  const security = read('src/middlewares/requestSecurity.js');
  const inventory = read('src/services/hotel/hotelInventoryService.js');
  assert(db.includes("mongoose.set('strictQuery', true)"));
  assert(db.includes("mongoose.set('sanitizeFilter', false)"));
  assert(app.includes('app.use(rejectDangerousInputKeys)'));
  assert(security.includes("value.startsWith('$')") && security.includes("value.includes('.')"));
  assert(inventory.includes("status: { $in: [...ACTIVE_UNIT_STATUSES] }"));
});
check('local ignored .env is not mistaken for a shipped release secret', () => {
  const hygiene = read('scripts/check-secret-hygiene.js');
  assert(hygiene.includes('isLocalEnvFile'));
  assert(hygiene.includes('gitIgnored'));
  assert(hygiene.includes("nextRel === 'scripts/check-secret-hygiene.js' || isLocalEnvFile(nextRel)"));
});
check('Git-history secrets remain a hard failure until purged and rotated', () => {
  const hygiene = read('scripts/check-secret-hygiene.js');
  assert(hygiene.includes('Git history contains no high-confidence secret values'));
  assert(hygiene.includes('Purge history and rotate the affected credentials before launch.'));
});
check('Pesapal doctor supports local credential-only mode but keeps strict production certification', () => {
  const doctor = read('scripts/doctor-pesapal.js');
  const provider = read('src/services/payment/pesapalPaymentProvider.js');
  assert(doctor.includes('localHost'));
  assert(doctor.includes("process.argv.includes('--production')"));
  assert(doctor.includes('pesapal.credentialCheck(config)'));
  assert(provider.includes('async function credentialCheck'));
  assert(doctor.includes('PESAPAL_CALLBACK_URL must use HTTPS on the APP_URL host.'));
});
if (!process.exitCode) console.log(`\n${checks.length}/${checks.length} v1.6.85 go-live hotfix checks passed.`);

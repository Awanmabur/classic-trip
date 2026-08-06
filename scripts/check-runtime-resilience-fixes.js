#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const failures = [];
function check(label, ok) {
  if (ok) console.log(`✓ ${label}`);
  else { console.error(`✖ ${label}`); failures.push(label); }
}

const env = read('src/config/env.js');
const db = read('src/config/db.js');
const repository = read('src/repositories/mongoRepository.js');
const gate = read('src/services/data/mongoReadGate.js');
const dashboard = read('src/services/dashboard/dashboardSnapshotService.js');
const catalog = read('src/services/marketplace/catalogService.js');
const returns = read('src/modules/bus/services/busSearchService.js');
const booking = read('src/modules/bus/services/busBookingService.js');
const inventory = read('src/modules/bus/services/busInventoryService.js');
const repair = read('src/services/migrations/legacyBusListingPublicationRepair.js');
const redirect = read('src/utils/safeRedirect.js');
const media = read('src/controllers/company/mediaController.js');
const promoter = read('src/controllers/promoter/networkController.js');
const auth = read('src/controllers/auth/authController.js');
const verification = read('src/controllers/admin/verificationController.js');
const upload = read('src/middlewares/upload.js');
const packageJson = JSON.parse(read('package.json'));

check('Mongo server-selection timeout is fail-fast and configurable', env.includes("Math.max(2500, number('MONGO_SERVER_SELECTION_TIMEOUT_MS', 4000)"));
check('Mongo wait queue is bounded to protect user-facing requests', env.includes("Math.max(1500, number('MONGO_WAIT_QUEUE_TIMEOUT_MS', 2500)"));
check('Startup performs multiple bounded connection attempts', env.includes("number('MONGO_CONNECT_RETRY_ATTEMPTS', 5)") && db.includes('isRetryableConnectionError'));
check('Dashboard and marketplace share the process-wide Mongo read gate', dashboard.includes('runMongoRead') && catalog.includes('runMongoRead') && gate.includes('MAX_ACTIVE_READS'));
check('Read gate reserves pool capacity for auth/session/write traffic', gate.includes('reservedConnections') && gate.includes('poolSize - reservedConnections'));
check('Idempotent Mongo reads retry one transient pool/topology failure', repository.includes('runRetryableRead') && repository.includes('mongowaitqueuetimeout') && repository.includes('Writes are never retried here'));
check('Return discovery starts from live future departures', returns.includes("status: { $in: ['published', 'boarding', 'delayed'] }") && returns.includes('departAt: { $gt: new Date() }'));
check('Return discovery is schedule-aware and does not compare outbound chronology', returns.includes('function journeyForSchedule') && returns.includes('scheduleTravelBounds') && !returns.includes('afterDate'));
check('Round-trip validation accepts reversed terminal identity across different route-stop ids', booking.includes('branchIdsReverse') && booking.includes('namesReverse') && booking.includes('stopIdsReverse'));
check('Bus holds persist canonical journey identity for later reverse validation', inventory.includes('originBranchId: availability.journey.originBranchId') && inventory.includes('destinationName: availability.journey.destinationName'));
check('Published bus marketplace state derives from live departure rather than stale listing flag', catalog.includes("const listingBookableGate = serviceType === 'bus' ? Boolean(nextSchedule)"));
check('Legacy publication repair restores live bus bookability from live inventory', repair.includes('const liveDeparture') && repair.includes('const liveInventory') && repair.includes('listing.bookable = bookable'));
check('Untrusted redirect targets are constrained to local paths', redirect.includes('safeRedirectPath') && media.includes('safeRedirectPath(req.body.next') && promoter.includes("safeRedirectPath(req.get('referer')") && auth.includes("safeRedirectPath(req.get('Referer'), '/account')") && verification.includes("safeRedirectPath(req.body.next, '/admin/kyc')"));
check('Multer is pinned to the patched 2.2 release line', packageJson.dependencies?.multer === '^2.2.0');
check('Multipart uploads are bounded by file/field/part limits', upload.includes('files: 2') && upload.includes('fields: 100') && upload.includes('parts: 102') && upload.includes('headerPairs: 200'));

if (failures.length) {
  console.error(`Runtime resilience audit failed (${15 - failures.length}/15).`);
  process.exit(1);
}
console.log('Runtime resilience audit passed (15/15).');

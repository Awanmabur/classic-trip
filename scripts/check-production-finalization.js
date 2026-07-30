#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [];
function expect(name, condition) { checks.push({ name, ok: Boolean(condition) }); }

const pkg = JSON.parse(read('package.json'));
const start = read('scripts/start.js');
const nodemon = JSON.parse(read('nodemon.json'));
const logger = read('src/config/logger.js');
const env = read('src/config/env.js');
const db = read('src/config/db.js');
const server = read('src/server.js');
const scheduler = read('src/jobs/scheduler.js');
const app = read('src/app.js');
const catalog = read('src/services/marketplace/catalogService.js');
const grouping = read('src/services/marketplace/catalogGrouping.js');
const dashboardSnapshot = read('src/services/dashboard/dashboardSnapshotService.js');
const dashboardMongo = read('src/services/dashboard/mongoDashboardService.js');
const adminDashboard = read('src/controllers/admin/dashboardController.js');
const auth = read('src/controllers/auth/authController.js');
const flash = read('src/middlewares/flash.js');

const loginAudit = read('src/models/LoginAudit.js');
const revenue = read('src/views/dashboards/shared/sections/revenue.ejs');
const terms = read('src/views/pages/terms.ejs');
const bookings = read('src/views/pages/my-bookings.ejs');

expect('npm start uses environment-aware launcher', pkg.scripts.start === 'node scripts/start.js');
expect('development launcher uses local nodemon', start.includes("require.resolve('nodemon/bin/nodemon.js')"));
expect('nodemon watches JS, EJS and CSS', nodemon.ext.includes('ejs') && nodemon.ext.includes('css'));
expect('nodemon is quiet and uses polling fallback', nodemon.quiet === true && nodemon.legacyWatch === true);
expect('development logger is concise', logger.includes("process.env.NODE_ENV === 'production' ? 'info' : 'warn'"));
expect('startup messages remain visible', logger.includes('startup:'));
expect('NODE_ENV typo is normalised', env.includes("develoment: 'development'"));
expect('slow logging is configurable', env.includes('LOG_SLOW_REQUESTS') && app.includes('env.performance.logSlowRequests'));
expect('routine disabled jobs are silent in development', scheduler.includes("if (env.isProduction) logger.warn('Scheduled jobs are disabled in production'"));
expect('MongoDB uses an explicit pool', db.includes('minPoolSize: env.mongoPool.min') && db.includes('maxPoolSize: env.mongoPool.max'));
expect('runtime auto-indexing is disabled by default', db.includes('autoIndex: env.mongoConnection.autoIndex') && env.includes("booleanFlag('MONGO_AUTO_INDEX', false)"));
expect('index deployment command exists', pkg.scripts['db:indexes'] && fs.existsSync(path.join(root, 'scripts/ensure-production-indexes.js')));
expect('production doctor command exists', pkg.scripts.doctor && fs.existsSync(path.join(root, 'scripts/production-doctor.js')));
expect('homepage catalogue has TTL and stale cache', catalog.includes('snapshotCache') && catalog.includes('homeCacheStaleMs'));
expect('homepage cache does not compete with web startup', !server.includes('catalogService.prewarmHome()'));
expect('all seven services are in the public catalogue', catalog.includes("TYPE_ORDER = ['bus', 'hotel', 'flight', 'local_transport', 'tour', 'car_rental', 'cargo']") && grouping.includes("'tour', 'car_rental', 'cargo'"));
expect('successful writes invalidate public and dashboard caches', flash.includes('invalidateMarketplaceCache') && flash.includes('dashboardSnapshotService'));
expect('dashboard cache defaults are production-friendly', dashboardSnapshot.includes('dashboardCacheTtlMs') && dashboardSnapshot.includes('dashboardCacheStaleMs'));
expect('dashboard snapshots are not cloned on every request', dashboardSnapshot.includes('return cached.value') && !dashboardSnapshot.includes('return clone(cached.value)'));
expect('dashboard projections reuse the same snapshot', dashboardMongo.includes('roleProjectionCache') && dashboardMongo.includes('cached?.snapshot === snapshot'));
expect('admin shell avoids duplicate partner and notification reads', !adminDashboard.includes("notificationService.dashboardRowsLive") && !adminDashboard.includes("listEntity('companies'"));
expect('successful login audit is non-blocking after session save', auth.includes('await saveSession(req)') && auth.includes('setImmediate(() =>'));
expect('server keeps only meaningful startup messages', server.includes("logger.startup(`${env.appName} listening`") && db.includes("logger.startup('MongoDB connected'"));

expect('homepage reads only live public catalogue records', catalog.includes("status: 'active', releaseStatus: 'published'") && catalog.includes("status: { $in: ['published', 'boarding', 'delayed'] }"));
expect('login lockout query has a matching compound index', loginAudit.includes("{ identity: 1, result: 1, createdAt: -1 }"));
expect('HTTP server has bounded request handling', server.includes('requestTimeout = 45_000') && server.includes('maxRequestsPerSocket'));
expect('production uses plain Node rather than nodemon', pkg.scripts['start:prod'] === 'node scripts/start-production.js' && start.includes("if (!watch)"));
expect('revenue filters cover every live service', revenue.includes('value="flight"') && revenue.includes('value="local_transport"'));
expect('public legal wording covers every live service', terms.includes('flight agents') && terms.includes('local-mobility partners'));
expect('booking history displays service-specific icons', bookings.includes("fa-plane") && bookings.includes("fa-motorcycle"));

const failures = checks.filter((check) => !check.ok);
checks.forEach((check) => console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}`));
if (failures.length) {
  console.error(`Production finalization checks failed (${checks.length - failures.length}/${checks.length}).`);
  process.exit(1);
}
console.log(`Production finalization checks passed (${checks.length}/${checks.length}).`);

#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const checks = [];
const check = (name, ok) => checks.push({ name, ok: Boolean(ok) });
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const sw = read('public/sw.js');
const seed = read('scripts/seed-launch-seo-operators.js');
const home = read('src/views/pages/home.ejs');
const workspace = read('public/js/dashboard-workspace.js');
const workspaceView = read('src/views/dashboards/shared/workspace.ejs');
const roleQuick = read('src/views/dashboards/shared/sections/role-quick-actions.ejs');
const companyRoutes = read('src/routes/web/company.js');
const employeeRoutes = read('src/routes/web/employee.js');
const promoterRoutes = read('src/routes/web/promoter.js');
const adminRoutes = read('src/routes/web/admin.js');
const publicRoutes = read('src/routes/web/public.js');
const listingController = read('src/controllers/public/listingController.js');
const catalog = read('src/services/marketplace/catalogService.js');
const rolling = read('src/jobs/materializeSchedules.js');
const departure = read('src/modules/bus/services/busDepartureService.js');
const projection = read('src/services/dashboard/dashboardProjectionEngine.js');
const env = read('src/config/env.js');
const render = read('render.yaml');
const errorHandler = read('src/middlewares/errorHandler.js');
const shell = read('src/services/dashboard/shellConfig.js');

check('package is v1.6.46 or newer', /^1\.6\.(?:4[6-9]|[5-9]\d|\d{3,})$/.test(pkg.version));
check('lockfile root version matches package', lock.version === pkg.version && lock.packages?.['']?.version === pkg.version);
check('service-worker cache matches release', sw.includes(`classic-trip-static-v${pkg.version}`));

const viewFiles = [];
(function walk(dir) {
  fs.readdirSync(path.join(root, dir), { withFileTypes: true }).forEach((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel);
    else if (entry.name.endsWith('.ejs')) viewFiles.push(rel);
  });
})('src/views');
const templateSource = viewFiles.map(read).join('\n');
const semanticVersions = [...templateSource.matchAll(/[?&]v=(1\.6\.\d+)/g)].map((m) => m[1]);
check('all semantic browser asset versions match package', semanticVersions.length > 40 && semanticVersions.every((v) => v === pkg.version));
const inlineScripts = [...templateSource.matchAll(/<script\b[\s\S]*?<\/script>/gi)].map((m) => m[0]).filter((tag) => !/\bsrc\s*=/.test(tag.split('>')[0]));
check('all inline scripts carry CSP nonce', inlineScripts.every((tag) => /nonce=/.test(tag.slice(0, 180))));
const jsonScripts = [...templateSource.matchAll(/<script\b[\s\S]*?<\/script>/gi)].map((m) => m[0]).filter((tag) => /type=["']application\/json["']/i.test(tag));
check('all application/json bootstraps use toScriptJson', jsonScripts.length >= 8 && jsonScripts.every((tag) => /toScriptJson\(/.test(tag)));

check('homepage keeps exactly three published blog previews', catalog.includes("blogs: data.blogs.filter((row) => normalize(row.status) === 'published').slice(0, 3)"));
check('homepage More blogs action opens the directory', home.includes('href="/blogs"') && home.includes('More blogs'));
const blogImages = [
  'public/images/blogs/v1645-book-bus-online.webp',
  'public/images/blogs/v1645-kampala-juba.webp',
  'public/images/blogs/v1645-kampala-nairobi.webp',
  'public/images/blogs/v1645-uganda-intercity.jpg',
  'public/images/blogs/v1645-cross-border.webp',
  'public/images/blogs/v1645-secure-booking.png',
  'public/images/blogs/v1645-holiday-night-travel.webp',
];
check('all seven dedicated blog images are bundled', blogImages.every((f) => exists(f) && fs.statSync(path.join(root, f)).size > 8000));
const blogMapBlock = seed.slice(seed.indexOf('const BLOG_IMAGES'), seed.indexOf('function seededMedia'));
check('blog seed maps article art only to dedicated blog media', blogMapBlock.includes('/media/blog/') && !blogMapBlock.includes('/images/operators/') && !blogMapBlock.includes('launch-lockup') && !blogMapBlock.includes('logo-symbol'));

const operatorImages = [
  'public/images/operators/bebeto-coach.webp',
  'public/images/operators/trinity-express.webp',
  'public/images/operators/zawadi-travel-service.jpg',
  'public/images/operators/eco-bus.webp',
  'public/images/operators/friendship-bus.png',
  'public/images/operators/yy-coaches.webp',
];
check('all six branded coach media files are bundled', operatorImages.every((f) => exists(f) && fs.statSync(path.join(root, f)).size > 8000));
check('operator seed maps all requested companies to coach media', ['bebeto-coach-services','trinity-express','zawadi-travel-service','eco-bus','friendship-bus','yy-coaches'].every((key) => seed.includes(`'${key}'`)) && seed.includes('OPERATOR_IMAGES[operator.key]'));
check('seed keeps operator data in review instead of fabricating compliance', seed.includes('must be confirmed before publication') && !seed.includes('FAKE_PERMIT'));

check('dashboard quick actions never fake a saved success', !workspace.includes("toast('Action saved')") && workspace.includes('This action is unavailable here. Use the dedicated dashboard page.'));
const modalTypes = ['ad','add-on','booking','branch','bus service','driver incident','driver trip update','handover','hotel property','listing','notice','partner','payment','promoter link','room type','route','schedule','support notice','vehicle'];
check('all static quick-action modal types have form handling', modalTypes.every((type) => workspace.includes(`'${type}'`) || workspace.includes(`key === '${type}'`) || workspace.includes(`key === \"${type}\"`)));
const companyPosts = ['/company/listings','/company/routes','/company/vehicles','/company/addons','/company/schedule-rules','/company/hotels/properties','/company/hotels/room-types','/company/branches','/company/support/notices','/company/seats/status'];
check('company quick actions are backed by real POST routes', companyPosts.every((route) => companyRoutes.includes(`router.post('${route}'`)));
const staffPosts = ['/employee/bookings','/employee/support/notice','/employee/handovers','/driver/trips/status','/driver/incidents','/driver/handovers'];
check('staff and driver quick actions are backed by real POST routes', staffPosts.every((route) => employeeRoutes.includes(`router.post('${route}'`)));
check('promoter quick action is backed by a real POST route', promoterRoutes.includes("router.post('/promoter/links'"));
const adminPosts = ['/operations/bookings','/admin/companies','/admin/promotions','/admin/notices','/admin/payments/freeze'];
check('operations/admin quick actions are backed by real POST routes', adminPosts.every((route) => adminRoutes.includes(`router.post('${route}'`)));
check('customer/support/finance/content quick actions use real routed pages', ['/account/bookings','/account/support','/promoter/commissions','/support/dashboard/support','/finance/dashboard/payments','/content/dashboard/blogs'].every((href) => roleQuick.includes(`href="${href}"`)));
check('all major dashboard roles remain configured', ['customer','company','employee','driver','promoter','support','finance','operations','content','admin'].every((role) => shell.includes(role)));

check('expired secure booking draft redirects back to the listing instead of a dead 409 page', listingController.includes("error?.code || '') === 'booking_draft_expired'") && listingController.includes("Your secure seat hold expired") && listingController.includes('res.redirect(303, `/listings/${serviceType}/${slug}'));
check('POST operational errors still preserve safe flash-and-back behavior', errorHandler.includes("req.method !== 'GET' && status < 500") && errorHandler.includes('return res.redirect(safeBack(req))'));
check('public booking prepare and booking routes remain present', publicRoutes.includes("router.post('/book/:serviceType/:slug/prepare'") && publicRoutes.includes("router.get('/book/:serviceType/:slug'"));

check('rolling window remains 30 calendar days', rolling.includes('const ROLLING_WINDOW_DAYS = 30'));
check('rolling recovery is intentionally lightweight', (env.includes("JOB_MATERIALIZE_SCHEDULES || '*/15 * * * *'") || env.includes("safeJobCron('JOB_MATERIALIZE_SCHEDULES', '*/15 * * * *'")) && render.includes('value: "*/15 * * * *"'));
check('outbox handles lifecycle materialization without ten-second cron churn', (env.includes("JOB_PROCESS_OUTBOX || '* * * * *'") || env.includes("safeJobCron('JOB_PROCESS_OUTBOX', '* * * * *'")) && render.includes('value: "* * * * *"'));
check('private rolling fallback is no longer started by the dedicated worker', !read('src/worker.js').includes('scheduleMaterializer.startWebFallback'));
check('historical vehicle blockers are cleared and do not freeze rules', rolling.includes("startsWith('vehicle_schedule_conflict')") && !rolling.includes('persistFullWindowVehicleConflictBlocker') && !rolling.includes('FULL_WINDOW_CONFLICT_RECHECK_MS'));
check('real vehicle overlaps are still rejected per date', rolling.includes('vehicleConflictsFromRows(conflictRows, departAt, arriveAt)') && rolling.includes("failures.add('vehicle_time_conflict')"));
check('legacy rules inherit configured route duration before overlap checks', rolling.includes('hydrateLegacyRuleDuration') && rolling.includes('route.estimatedDurationMinutes') && rolling.includes('parseDurationMinutes(route.estimatedDuration'));
check('dormant duplicate and overlapping same-service recurring rules are safely normalized', rolling.includes('pauseDormantExactDuplicateRules') && rolling.includes('pauseDormantOverlappingRules') && rolling.includes('sameRecurringService') && rolling.includes('futureCount') && rolling.includes("status: 'paused'"));
check('duplicate normalization never auto-pauses rules owning live future departures', rolling.includes('if (Number(futureCount || 0) > 0) continue'));
check('departure lifecycle queues replacement materialization', departure.includes("eventType: 'ScheduleRuleMaterializationRequested'") && departure.includes('departure-${schedule.id}'));
check('dashboard labels legacy vehicle blockers as automatic retry', projection.includes('· retrying automatically') && projection.includes('retryingAutomatically: legacyVehicleBlocker'));

check('current launch gate includes security, role, frontend, backend and rolling audits', ['check:v1646-final-launch','check:frontend-complete','check:architecture-security','check:routes','check:csrf','check:dashboard-completeness','check:dashboard-service-coverage','check:dashboard-workflows','check:backend-end-to-end','check:performance-edit-payment-repair','check:root-performance-current-fare-rolling-ui','check:production-readiness-final','check:system-completion'].every((name) => String(pkg.scripts.verify || '').includes(`npm run ${name}`)));

const failed = checks.filter((row) => !row.ok);
checks.forEach((row) => console.log(`${row.ok ? '✓' : '✗'} ${row.name}`));
if (failed.length) {
  console.error(`v1.6.46+ final-launch regression audit failed (${checks.length - failed.length}/${checks.length}).`);
  process.exit(1);
}
console.log(`v1.6.46+ final-launch regression audit passed (${checks.length}/${checks.length}).`);

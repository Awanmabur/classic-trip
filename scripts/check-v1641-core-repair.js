'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [];
function check(name, ok) { checks.push({ name, ok: Boolean(ok) }); }

const pkg = JSON.parse(read('package.json'));
const rolling = read('src/jobs/materializeSchedules.js');
const departure = read('src/modules/bus/services/busDepartureService.js');
const snapshot = read('src/services/dashboard/dashboardSnapshotService.js');
const adminRoutes = read('src/routes/web/admin.js');
const adminActions = read('src/controllers/admin/actionController.js');
const workspace = read('public/js/dashboard-workspace.js');
const notificationView = read('src/views/dashboards/shared/sections/notifications.ejs');
const dashboardCss = read('public/css/dashboard-workspace.css');
const notificationService = read('src/services/notification/notificationService.js');
const notificationJs = read('public/js/notifications.js');
const pushService = read('src/services/notification/pushService.js');
const sw = read('public/sw.js');
const calculator = read('src/utils/calculateCommission.js');
const platformConfig = read('src/services/platform/platformConfigService.js');
const settings = read('src/views/dashboards/shared/sections/settings.ejs');
const authRoutes = read('src/routes/web/auth.js');
const authController = read('src/controllers/auth/authController.js');
const redirects = read('src/utils/dashboardRedirect.js');

check('release includes v1.6.41 core repair', pkg.version === '1.6.48');
check('rolling rules preserve their original recurring occurrence count', rolling.includes('rollingTargetDepartureCount') && rolling.includes('futureCount < targetDepartureCount') && rolling.includes('extensionDays < 14'));
check('departure lifecycle immediately requeues its recurring rule', departure.includes("eventType: 'ScheduleRuleMaterializationRequested'") && departure.includes("['departed', 'arrived', 'completed', 'cancelled', 'archived'].includes(next)"));
check('real vehicle conflicts remain enforced', rolling.includes('vehicle_time_conflict') && departure.includes('Selected vehicle is already assigned to an overlapping departure'));
check('Super Admin listing approval and rejection routes exist', adminRoutes.includes("router.post('/admin/listings/:id/approve'") && adminRoutes.includes("router.post('/admin/listings/:id/reject'"));
check('listing approval uses service-aware publish readiness and invalidates stale dashboards', adminActions.includes('companyService.publishListing') && adminActions.includes("dashboardSnapshotService.invalidate('admin', { activePage: 'listings' })") && adminActions.includes("dashboardSnapshotService.invalidate('company'"));
const idDeclaration = workspace.indexOf("const id = rawId ? encodeURIComponent(rawId) : '';");
const listingReviewBranch = workspace.indexOf("entity === 'listing_review' && id");
check('listing review row actions declare their id before using it', idDeclaration >= 0 && listingReviewBranch > idDeclaration);
check('Admin page plans restore domain dependencies without making Notifications a Support page', snapshot.includes('...pageEntities, ...groupEntities') && !snapshot.includes("support: 'support', notifications: 'support'"));
check('notification center has explicit card padding on desktop and phone', notificationView.includes('notificationCenterCard') && dashboardCss.includes('.notificationCenterCard{padding:16px') && dashboardCss.includes('.notificationCenterCard{padding:12px'));
check('booking confirmation creates Partner Admin and Super Admin operational alerts', notificationService.includes("alertScope: 'partner_booking'") && notificationService.includes("alertScope: 'admin_booking'") && notificationService.includes("alertSound: 'booking'"));
check('open dashboards receive immediate push booking-sound signals with polling fallback', pushService.includes('alertSound: message.meta?.alertSound') && sw.includes("type: 'classic-trip-push'") && notificationJs.includes('listenForPushBookingAlerts') && notificationJs.includes('setInterval(poll, 10000)'));
check('UGX promoter commission defaults to a fixed 2000 reward', platformConfig.includes('promoterFixedUgx: 2000') && calculator.includes('rates.currency === getCachedPlatformConfig().ugandaCurrency') && calculator.includes('Math.min(rates.promoterFixedUgx, totalCommission)'));
check('finance UI exposes fixed UGX promoter commission', settings.includes('Promoter commission per eligible UGX booking') && settings.includes('promoterFixedUgx'));
check('one canonical account page still handles login/signup while POST registration remains real', authRoutes.includes("router.get('/register'") && authRoutes.includes("#signup") && authRoutes.includes("router.post('/register'") && authController.includes("role: ({ partner: 'company_admin'"));
check('all primary role dashboards still have explicit destinations', ['super_admin','admin','finance_admin','support_admin','operations_admin','content_admin','company_admin','company_employee','driver','promoter','customer'].every((role) => redirects.includes(`${role}:`)));

const failed = checks.filter((row) => !row.ok);
checks.forEach((row) => console.log(`${row.ok ? 'PASS' : 'FAIL'}: ${row.name}`));
if (failed.length) {
  console.error(`v1.6.41 core repair checks failed (${checks.length - failed.length}/${checks.length}).`);
  process.exit(1);
}
console.log(`v1.6.41 core repair checks passed (${checks.length}/${checks.length}).`);

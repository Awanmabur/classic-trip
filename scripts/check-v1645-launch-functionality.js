'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = require('../package.json');
const {
  BLOG_MEDIA,
  OPERATOR_MEDIA,
  blogPresentation,
  listingPresentationMedia,
  isLogoLikeImage,
} = require('../src/config/launchMedia');

const home = read('src/views/pages/home.ejs');
const listingCard = read('src/views/partials/listing-card.ejs');
const workspace = read('src/views/dashboards/shared/workspace.ejs');
const roleActions = read('src/views/dashboards/shared/sections/role-quick-actions.ejs');
const overviewActions = read('src/views/dashboards/shared/sections/overview-quick-actions.ejs');
const dashboardJs = read('public/js/dashboard-workspace.js');
const catalog = read('src/services/marketplace/catalogService.js');
const publicBlogs = read('src/controllers/public/blogController.js');
const seed = read('scripts/seed-launch-seo-operators.js');
const scheduler = read('src/jobs/scheduler.js');
const materializer = read('src/jobs/materializeSchedules.js');
const slugignore = read('.slugignore');
const app = read('src/app.js');
const csrf = read('src/middlewares/csrf.js');
const companyRoutes = read('src/routes/web/company.js');
const employeeRoutes = read('src/routes/web/employee.js');
const customerRoutes = read('src/routes/web/customer.js');
const promoterRoutes = read('src/routes/web/promoter.js');
const adminRoutes = read('src/routes/web/admin.js');

const checks = [];
const check = (name, ok) => checks.push([name, Boolean(ok)]);
const hasAll = (source, values) => values.every((value) => source.includes(value));

check('release and Service Worker cache are v1.6.45', pkg.version === '1.6.45' && read('public/sw.js').includes("classic-trip-static-v1.6.45"));
check('all seven guide photographs have a meaningful URL and alt', Object.keys(BLOG_MEDIA).length === 7 && Object.values(BLOG_MEDIA).every((media) => /^https:\/\//.test(media.url) && media.alt.length > 20));
check('all six launch operators have identified coach photographs', Object.keys(OPERATOR_MEDIA).length === 6 && Object.values(OPERATOR_MEDIA).every((media) => /^https:\/\//.test(media.url) && /^https:\/\//.test(media.sourceUrl) && /coach|bus/i.test(media.alt)));
check('logo detector recognizes Classic Trip launch artwork', isLogoLikeImage('/images/launch-lockup-512.png') && isLogoLikeImage('/images/logo-symbol.svg'));
check('blog runtime presentation replaces a stored logo', blogPresentation({ slug: Object.keys(BLOG_MEDIA)[0], image: '/images/launch-lockup-512.png', title: 'Guide' }).image === Object.values(BLOG_MEDIA)[0].url);
check('blog runtime presentation preserves a real custom photograph', blogPresentation({ slug: Object.keys(BLOG_MEDIA)[0], image: 'https://example.com/custom-trip.jpg' }).image === 'https://example.com/custom-trip.jpg');
check('listing runtime presentation replaces a stored operator logo', listingPresentationMedia({ title: 'Bebeto Coach Services', media: [{ url: '/images/logo-symbol.svg' }] }, { name: 'Bebeto Coach Services' }).image === OPERATOR_MEDIA['bebeto-coach-services'].url);
check('listing runtime presentation preserves a real custom coach photograph', listingPresentationMedia({ title: 'Bebeto Coach Services', media: [{ url: 'https://example.com/custom-bus.jpg', alt: 'Custom bus' }] }, { name: 'Bebeto Coach Services' }).image === 'https://example.com/custom-bus.jpg');
check('marketplace projection applies real listing and blog presentation media', hasAll(catalog, ['listingPresentationMedia(listing, company || {})', 'blogPresentation(row)', 'imageAlt: presentationMedia?.imageAlt', 'imageAlt: presented.imageAlt']));
check('blog index, detail and related articles use presentation media', publicBlogs.includes('blogPresentation') && (publicBlogs.match(/blogPresentation/g) || []).length >= 4);
check('launch seed repairs missing or logo-like listing and blog media', hasAll(seed, ['isMissingOrLogoLikeImage', 'listingImagesUpdated', 'blogImagesUpdated']));
check('seeded departure research remains Draft and operator-confirmation blocked', hasAll(seed, ["status: 'draft'", 'operatorConfirmationRequired: true', "'vehicle_required'", "'seat_map_required'", "'fare_inventory_required'"]) && !/TripSchedule[\s\S]{0,900}status:\s*'published'/.test(seed));
check('rolling departure dates follow the rule timezone instead of host timezone', hasAll(materializer, ['safeTimeZone(rule.timezone)', 'calendarDateKey(now, timeZone)', 'combineDateAndTime(day, rule.departureTime, timeZone)', 'timezone: safeTimeZone(rule.timezone)']));

check('Home retains exactly three blog cards and a More link to the full blog page', home.includes('(bootstrap.blogs || []).slice(0, 3)') && /href="\/blogs"[^>]*>/.test(home));
check('public external imagery uses no-referrer and descriptive alt text', home.includes('referrerpolicy="no-referrer"') && listingCard.includes('referrerpolicy="no-referrer"') && listingCard.includes('listing.imageAlt'));
check('Home has a usable database-reconnect state instead of a root 503', hasAll(catalog, ['degradedHomeBootstrap(error)', 'degradedHomeBootstrapRetryAt = Date.now() + 5000', 'return degradedHomeBootstrapCache']) && home.includes('bootstrap.degradedMessage'));

check('dashboard Quick Actions are links, not inert overview buttons', !overviewActions.includes('<button class="quickCard"') && !roleActions.includes('<button class="quickCard"'));
check('dashboard destinations are generated from the role-specific real page', hasAll(workspace, ['const shellPageHref = function', 'const shellHasRealPage = function', 'const shellActionHref = function', "params.set('action', mode)", "params.set('type', type)"]));
check('company bus shortcuts cover setup through departure operations', hasAll(overviewActions, ["shellActionHref('company-profile', 'branch'", "shellActionHref('listings', 'bus service'", "shellActionHref('routes', 'route'", "shellActionHref('vehicles', 'vehicle'", "shellActionHref('schedules', 'schedule'", 'href="/company/manifests"']));
check('stay shortcuts open listing, property, room, booking and check-in pages', hasAll(overviewActions, ["shellActionHref('hotel-rooms', 'hotel property'", "shellActionHref('hotel-rooms', 'room type'", "shellPageHref('bookings')", "shellPageHref('checkins')"]));
check('employee and driver shortcuts are hidden when their real page is unavailable', roleActions.includes("shellHasRealPage('driver-ops')") && overviewActions.includes("shellHasRealPage('checkin')") && overviewActions.includes("shellHasRealPage('handover')"));
check('promoter and assisted-booking shortcuts open their actual creation pages', roleActions.includes("shellActionHref('links', 'promoter link', 'create')") && roleActions.includes("shellActionHref('bookings', 'booking', 'create')"));
check('destination pages consume, validate and then clear requested actions', hasAll(dashboardJs, ['function openRequestedPageAction()', "['create', 'edit', 'view'].includes(mode)", '/^[a-z0-9 _-]+$/', 'type.length > 80', "openCrud(mode, type, '', {})", "url.searchParams.delete('action')", "url.searchParams.delete('type')"]));

check('company routes enforce authentication, role and company scope', companyRoutes.includes("router.use('/company', requireAuth, requireRole('company_admin', 'super_admin'), enforceCompanyScope)"));
check('company setup endpoints exist behind a sensitive-action limiter', companyRoutes.includes("router.post('/company/*', sensitiveActionLimiter)") && hasAll(companyRoutes, ["router.post('/company/bus-services'", "router.post('/company/routes'", "router.post('/company/vehicles'", "router.post('/company/schedules'", "router.post('/company/branches'"]));
check('employee and driver namespaces enforce role, tenant and operational scopes', hasAll(employeeRoutes, ["router.use('/employee', requireAuth", 'enforceCompanyScope', "router.use('/driver', requireAuth", "requireCompanyService('bus')", 'requireOperationalDriver', "router.post('/employee/*', sensitiveActionLimiter)", "router.post('/driver/*', sensitiveActionLimiter)"]));
check('employee mutations require explicit capability permissions', hasAll(employeeRoutes, ["requirePermission('booking.create_manual')", "requirePermission('inventory.update')", "requirePermission('checkin.manage')", "requirePermission('handover.create')"]));
check('customer and promoter dashboards are auth/role scoped and rate limited', hasAll(customerRoutes, ["router.use('/account', requireAuth, requireRole('customer', 'super_admin'))", "router.post('/account/*', sensitiveActionLimiter)"]) && hasAll(promoterRoutes, ["router.use('/promoter', requireAuth, requireRole('promoter', 'super_admin'))", "router.post('/promoter/*', sensitiveActionLimiter)", 'requireVerifiedPromoter']));
check('admin specialties are role-separated, MFA protected and rate limited', ['content', 'support', 'finance', 'operations'].every((area) => adminRoutes.includes(`router.use('/${area}', requireAuth`) && adminRoutes.includes(`router.post('/${area}/*', sensitiveActionLimiter)`)) && adminRoutes.includes('requirePlatformMfa'));
check('global CSRF middleware protects unsafe form and JSON requests', app.includes('app.use(csrfToken)') && hasAll(csrf, ['SAFE_METHODS', 'invalid_csrf_token', 'timingSafeEqual', 'isSameOriginRequest']));
check('multipart uploads use explicit CSRF verification', companyRoutes.includes('requireCsrfToken') && companyRoutes.includes('upload.fields'));
check('scheduler uses non-overlap and bounded missed-run aggregation', hasAll(scheduler, ['noOverlap: true', "task.on?.('execution:missed'", 'recordMissedExecution', 'missedExecutionSummary', 'setTimeout(() =>']));
check('deployment keeps .env.example while excluding real secrets', fs.existsSync(path.join(root, '.env.example')) && slugignore.includes('!.env.example'));

const failed = checks.filter(([, ok]) => !ok);
checks.forEach(([name, ok]) => console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`));
if (failed.length) {
  console.error(`v1.6.45 launch functionality checks failed (${checks.length - failed.length}/${checks.length}).`);
  process.exit(1);
}
console.log(`v1.6.45 launch functionality checks passed (${checks.length}/${checks.length}).`);

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const failures = [];

function source(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function assertContains(file, pattern, message) {
  const text = source(file);
  assert(pattern.test(text), `${file}: ${message}`);
}

const privateWebPolicies = [
  {
    file: 'src/routes/web/admin.js',
    boundaries: [
      /router\.use\('\/admin',\s*requireAuth,\s*requireRole\('super_admin'\),\s*requirePlatformMfa\)/,
      /router\.use\('\/support',\s*requireAuth,\s*requireRole\('super_admin',\s*'admin',\s*'support_admin'\),\s*requirePlatformMfa,\s*rewriteAdminRedirect\('support'\)\)/,
      /router\.use\('\/finance',\s*requireAuth,\s*requireRole\('super_admin',\s*'admin',\s*'finance_admin'\),\s*requirePlatformMfa,\s*rewriteAdminRedirect\('finance'\)\)/,
      /router\.use\('\/operations',\s*requireAuth,\s*requireRole\('super_admin',\s*'admin',\s*'operations_admin'\),\s*requirePlatformMfa,\s*rewriteAdminRedirect\('operations'\)\)/,
      /router\.use\('\/content',\s*requireAuth,\s*requireRole\('super_admin',\s*'admin',\s*'content_admin'\),\s*requirePlatformMfa,\s*rewriteAdminRedirect\('content'\)\)/,
      /router\.post\('\/admin\/\*',\s*sensitiveActionLimiter\)/,
      /router\.post\('\/support\/\*',\s*sensitiveActionLimiter\)/,
      /router\.post\('\/finance\/\*',\s*sensitiveActionLimiter\)/,
      /router\.post\('\/operations\/\*',\s*sensitiveActionLimiter\)/,
      /router\.post\('\/content\/\*',\s*sensitiveActionLimiter\)/,
      /router\.post\('\/support\/notices',\s*requirePermission\('support\.manage'\)/,
      /router\.post\('\/finance\/finance-rules',\s*requirePermission\('finance\.manage'\)/,
      /router\.post\('\/operations\/listings',\s*requirePermission\('operations\.manage'\)/,
      /router\.post\('\/content\/notices',\s*requirePermission\('content\.manage'\)/,
    ],
  },
  {
    file: 'src/routes/web/company.js',
    boundaries: [
      /router\.use\('\/company',\s*requireAuth,\s*requireRole\('company_admin',\s*'super_admin'\),\s*enforceCompanyScope\)/,
      /router\.post\('\/company\/\*',\s*sensitiveActionLimiter\)/,
    ],
  },
  {
    file: 'src/routes/web/customer.js',
    boundaries: [
      /router\.use\('\/account',\s*requireAuth,\s*requireRole\('customer',\s*'super_admin'\)\)/,
      /router\.post\('\/account\/\*',\s*sensitiveActionLimiter\)/,
    ],
  },
  {
    file: 'src/routes/web/employee.js',
    boundaries: [
      /router\.use\('\/employee',\s*requireAuth,\s*requireRole\('company_employee',\s*'company_admin',\s*'super_admin'\),\s*enforceCompanyScope\)/,
      /router\.use\('\/driver',\s*requireAuth,\s*requireRole\('driver',\s*'super_admin'\),\s*enforceCompanyScope,\s*requireCompanyService\('bus'\),\s*requireOperationalDriver\)/,
      /router\.post\('\/employee\/\*',\s*sensitiveActionLimiter\)/,
      /router\.post\('\/driver\/\*',\s*sensitiveActionLimiter\)/,
      /requirePermission\(/,
    ],
  },
  {
    file: 'src/routes/web/promoter.js',
    boundaries: [
      /router\.use\('\/promoter',\s*requireAuth,\s*requireRole\('promoter',\s*'super_admin'\)\)/,
      /router\.post\('\/promoter\/\*',\s*sensitiveActionLimiter\)/,
    ],
  },
];

for (const policy of privateWebPolicies) {
  const text = source(policy.file);
  for (const boundary of policy.boundaries) {
    assert(boundary.test(text), `${policy.file}: missing required authentication, tenant, permission, or mutation-rate boundary (${boundary})`);
  }
}

const explicitPolicies = [
  ['src/routes/web/auth.js', /router\.post\('\/login',\s*authLimiter,\s*loginRules,\s*validateRequest/, 'login must be rate-limited and validated'],
  ['src/routes/web/auth.js', /router\.post\('\/register',\s*authLimiter,\s*registerRules,\s*validateRequest/, 'registration must be rate-limited and validated'],
  ['src/routes/web/auth.js', /router\.post\('\/reset-password',\s*authLimiter,\s*resetPasswordRules,\s*validateRequest/, 'password reset must be rate-limited and validated'],
  ['src/routes/web/auth.js', /router\.post\('\/account\/resend-verification',\s*authLimiter/, 'verification resend must be rate-limited'],
  ['src/routes/api/bookings.js', /router\.post\('\/',\s*paymentLimiter,\s*bookingRules,\s*validateRequest/, 'booking creation must be rate-limited and validated'],
  ['src/routes/api/listings.js', /router\.post\('\/:listingId\/hold',\s*publicWriteLimiter/, 'public inventory holds must be rate-limited'],
  ['src/routes/api/payments.js', /router\.post\('\/initiate',\s*requireApiAuth,\s*paymentLimiter,\s*paymentRules,\s*validateRequest/, 'payment initiation must be authenticated, rate-limited, and validated'],
  ['src/routes/api/webhooks.js', /router\.post\('\/payments',\s*webhookLimiter,\s*paymentController\.webhook/, 'payment webhook must be rate-limited'],
  ['src/routes/api/uploads.js', /router\.use\(requireApiAuth,\s*requirePlatformMfa\)/, 'uploads must require API authentication and administrator MFA when applicable'],
  ['src/routes/api/uploads.js', /canUploadMedia/, 'uploads must enforce an eligible role'],
  ['src/routes/api/uploads.js', /upload\.single\('file'\)/, 'uploads must pass through upload validation'],
  ['src/routes/api/scanner.js', /router\.use\(requireApiAuth,\s*requireApiRole\([\s\S]*?\),\s*requirePlatformMfa,\s*enforceCompanyScope\)/, 'scanner must enforce authentication, role, administrator MFA, and company scope'],
  ['src/routes/api/dashboards.js', /router\.use\(requireApiAuth,\s*requireApiRole\([\s\S]*?\),\s*requirePlatformMfa,\s*enforceCompanyScope\)/, 'dashboard API must enforce authentication, role, administrator MFA, and tenant scope'],
  ['src/routes/api/notifications.js', /router\.use\(requireApiAuth,\s*requireApiRole\([\s\S]*?\),\s*requirePlatformMfa\)/, 'notifications must enforce authentication, role, and administrator MFA'],
];
for (const [file, pattern, message] of explicitPolicies) assertContains(file, pattern, message);

const publicBookingRoutes = source('src/routes/web/public.js');
const apiBookingRoutes = source('src/routes/api/bookings.js');
assert(!/['"]\/cart(?:\/|['"])/.test(publicBookingRoutes), 'src/routes/web/public.js: legacy cart creation and checkout routes must remain retired');
assert(!/['"]\/cart(?:\/|['"])/.test(apiBookingRoutes), 'src/routes/api/bookings.js: legacy cart API routes must remain retired');

const csrf = source('src/middlewares/csrf.js');
assert(/SAFE_METHODS/.test(csrf), 'src/middlewares/csrf.js: safe methods must be explicitly defined');
assert(/\^\\\/api\\\/webhooks\\\//.test(csrf), 'src/middlewares/csrf.js: only webhook callbacks may bypass browser CSRF');
assert(!/req\.query/.test(csrf), 'src/middlewares/csrf.js: CSRF tokens must not be accepted through query strings');
assert(/timingSafeEqual/.test(csrf), 'src/middlewares/csrf.js: CSRF comparison must be constant-time');

const adminDashboardController = source('src/controllers/admin/dashboardController.js');
assert(/mongoDashboardService\.roleDashboard\(role\)/.test(adminDashboardController), 'specialized dashboards must request their role-scoped projection');
assert(/role === 'admin' \? mongoDashboardService\.listEntity\('companies'/.test(adminDashboardController), 'raw company selector data must be limited to Super Admin');
const dashboardWorkspace = source('public/js/dashboard-workspace.js');
assert(/platformActionPath/.test(dashboardWorkspace), 'specialized dashboard actions must use role-scoped action paths');

const webhookController = source('src/controllers/api/paymentController.js');
const webhookService = source('src/services/payment/webhookService.js');
assert(/rawBody/.test(webhookController), 'payment webhook controller must pass the original request body to signature verification');
assert(/verifyWebhookSignature|timingSafeEqual|webhookSecret/.test(webhookService), 'payment webhook service must verify provider signatures');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Route security audit passed.');

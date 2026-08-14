'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const checks = [];
const failures = [];

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function all(...rels) { return rels.map(read).join('\n'); }
function check(label, condition, detail = '') {
  checks.push(label);
  if (condition) console.log(`✓ ${label}`);
  else { failures.push(detail ? `${label}: ${detail}` : label); console.error(`✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function has(text, ...needles) { return needles.every((needle) => typeof needle === 'string' ? text.includes(needle) : needle.test(text)); }

const env = read('src/config/env.js');
const app = read('src/app.js');
const db = read('src/config/db.js');
const logger = read('src/config/logger.js');
const session = read('src/config/session.js');
const authRoutes = read('src/routes/web/auth.js');
const publicRoutes = read('src/routes/web/public.js');
const apiAuth = read('src/middlewares/apiAuth.js');
const companyAccess = read('src/middlewares/companyAccess.js');
const requestSecurity = read('src/middlewares/requestSecurity.js');
const botProtection = read('src/middlewares/botProtection.js');
const rateLimit = read('src/middlewares/rateLimit.js');
const authService = read('src/services/auth/authService.js');
const authController = read('src/controllers/auth/authController.js');
const sensitive = read('src/services/security/sensitiveFieldService.js');
const identityMigration = read('scripts/migrate-sensitive-identities.js');
const identityModels = all('src/models/Booking.js', 'src/models/Passenger.js', 'src/models/HotelGuest.js');
const identityWriters = all('src/modules/bus/services/busBookingService.js', 'src/services/hotel/hotelService.js', 'src/services/booking/bookingBuilderService.js');
const upload = all('src/middlewares/upload.js', 'src/services/media/uploadService.js');
const apiResponse = read('src/middlewares/apiResponseSecurity.js');
const csrf = read('src/middlewares/csrf.js');
const packageJson = JSON.parse(read('package.json'));
const bookingForm = read('src/views/pages/booking-form.ejs');
const paymentValidator = read('src/validators/paymentValidator.js');
const loginView = read('src/views/pages/auth/login.ejs');
const partnerView = read('src/views/pages/auth/_partner-signup.ejs');
const resetView = read('src/views/pages/auth/reset-password.ejs');
const inviteView = read('src/views/pages/invite-accept.ejs');

check('1/20 Hide API keys', has(env, 'PESAPAL_CONSUMER_SECRET', 'CLOUDINARY_API_SECRET') && read('.gitignore').includes('.env') && has(logger, 'sanitizeLogValue', 'secretLogKey', '[REDACTED]') && !/MONGO_URI|PESAPAL_CONSUMER_SECRET|CLOUDINARY_API_SECRET/.test(all('public/sw.js', 'src/views/partials/site-head.ejs')));
check('2/20 Purge Git secrets', packageJson.scripts['check:secret-hygiene'] && has(read('scripts/check-secret-hygiene.js'), "git', ['log'", 'high-confidence secret values', '*.pem'));
check('3/20 Use server-only database credentials', has(db, 'mongoose.connect(env.mongoUri') && has(env, 'MONGO_URI') && !/MONGO_URI/.test(all('public/sw.js', 'src/views/pages/home.ejs')));
check('4/20 Enforce row/tenant-level access', has(companyAccess, 'enforceCompanyScope', 'company_scope_denied', 'companyId') && has(apiAuth, 'requireApiAuth', 'refreshSessionUser'));
check('5/20 Encrypt sensitive data at rest', has(sensitive, "aes-256-gcm", 'env.dataEncryptionKey', "CURRENT_VERSION = 'v2'", "LEGACY_VERSION = 'v1'") && has(env, 'DATA_ENCRYPTION_KEY', 'dataEncryptionKey') && has(identityModels, 'identityNumberEncrypted', 'identityNumberLast4') && has(identityWriters, "'bus-passenger-identity'", "'hotel-guest-identity'", "'booking-buyer-document'") && has(identityMigration, 'DATA_ENCRYPTION_KEY must be explicitly set', '$unset', 'remainingPlaintext') && packageJson.scripts['security:encrypt-identities']);
check('6/20 Enforce server-side authentication', has(apiAuth, 'requireApiAuth', 'accountIsActive') && has(authController, 'req.session.regenerate'));
check('7/20 Lock record access to owners/scopes', has(companyAccess, 'enforceCompanyScope', 'ownedRequestServiceMatches', 'companyId') && fs.existsSync(path.join(root, 'src/services/booking/ticketAccessService.js')));
check('8/20 Block protected-field tampering', has(requestSecurity, 'rejectPublicFieldTampering', 'PUBLIC_PROTECTED_FIELDS', 'paymentStatus', 'commissionPercent') && has(publicRoutes, 'rejectPublicFieldTampering') && has(paymentValidator, 'Payment amount is calculated from the booking', 'Payment currency is calculated from the booking') && !/name=["']total["']/.test(bookingForm));
check('9/20 Secure session cookies', has(session, 'httpOnly: true', 'secure: env.isProduction', "sameSite: 'lax'", "priority: 'high'") && has(authController, 'req.session.regenerate'));
check('10/20 Hash passwords safely', has(authService, "require('bcryptjs')", 'bcrypt.hash', ', 12)', 'bcrypt.compare', 'DUMMY_PASSWORD_HASH'));
check('11/20 Rate limit login and lock accounts', has(rateLimit, "createLimiter('auth'", "createLimiter('login_daily_ip'", '24 * 60 * 60 * 1000') && has(authRoutes, 'loginDailyLimiter') && has(authService, 'LOGIN_LOCKOUT_THRESHOLD', 'account_locked'));
check('12/20 Add bot protection', has(botProtection, 'humanFormGuard', '_ct_hp', '_ct_bot', 'createHmac') && [loginView, partnerView, resetView, inviteView].every((view) => view.includes('name="_ct_bot"') && view.includes('name="_ct_hp"')) && has(authRoutes, 'humanFormGuard'));
check('13/20 Prevent query/operator injection', has(db, "mongoose.set('strictQuery', true)", "mongoose.set('sanitizeFilter', false)") && has(app, 'app.use(rejectDangerousInputKeys)') && has(requestSecurity, "value.startsWith('$')", "value.includes('.')", "'__proto__'") && !/\$where\s*:/.test(all('src/repositories/domain/companyAccessRepository.js', 'src/services/booking/bookingService.js')));
check('14/20 Validate all untrusted input', has(app, "express.urlencoded({ extended: true, limit: '2mb'", "express.json({ limit: '2mb'") && has(requestSecurity, 'rejectDangerousInputKeys') && has(csrf, "assertSafeObjectKeys(req.body, 'multipart')") && has(authRoutes, 'validateRequest'));

const rawEjs = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.ejs$/i.test(entry.name)) {
      const rel = path.relative(root, full).replace(/\\/g, '/');
      const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
      lines.forEach((line, idx) => {
        if (!line.includes('<%-')) return;
        if (/include\s*\(/.test(line) || /toScriptJson\s*\(/.test(line) || /<%-\s*schemaJson\s*%>/.test(line) || /guest\.isLeadGuest\s*\?\s*'<br><small>Lead guest<\/small>'/.test(line)) return;
        rawEjs.push(`${rel}:${idx + 1}`);
      });
    }
  }
})(path.join(root, 'src/views'));
check('15/20 Escape user content and script JSON', has(app, "replace(/[<>&\\u2028\\u2029]/g", "'<'", "'\\\\u003c'") && rawEjs.length === 0, rawEjs.join(', '));
check('16/20 Restrict and verify uploads', has(upload, 'fileSize:', 'ALLOWED_MIME_EXTENSIONS', 'memoryStorage', 'file signature', 'application/pdf') || (has(upload, 'fileSize:', 'ALLOWED_MIME_EXTENSIONS') && /signature|magic/i.test(upload)));
check('17/20 Trim/redact API responses', has(apiResponse, 'scrubSensitiveResponse', 'REDACTED_KEYS', 'passwordHash', 'consumerSecret', "Cache-Control', 'no-store, private") && has(app, 'apiResponseSecurity'));
check('18/20 Add modern security headers', has(app, 'helmet(', 'contentSecurityPolicy', 'strictTransportSecurity', 'Permissions-Policy', 'strict-origin-when-cross-origin'));
check('19/20 Force encrypted transport', has(app, 'req.secure', "redirect(308, `https://") && /MONGO_URI.*mongodb\+srv|tls=true|ssl=true/s.test(env) && /APP_URL.*https/i.test(env));
check('20/20 Scan production dependencies at release', packageJson.scripts['audit:production']?.includes('npm audit --omit=dev') && packageJson.scripts['release:check']?.includes('audit:production'));

if (failures.length) {
  console.error(`\nSecurity launch validation failed (${failures.length}/${checks.length}):`);
  failures.forEach((failure, index) => console.error(`${index + 1}. ${failure}`));
  process.exit(1);
}
console.log(`\n20/20 launch security checks passed.`);

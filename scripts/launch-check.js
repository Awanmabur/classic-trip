const fs = require('fs');
const path = require('path');

if (process.argv.includes('--production')) {
  process.env.NODE_ENV = 'production';
}

const { env, validateEnv } = require('../src/config/env');

const projectRoot = path.join(__dirname, '..');
const lockPath = path.join(projectRoot, 'package-lock.json');

const errors = [];
const warnings = [];

function addError(message) {
  errors.push(message);
}

function addWarning(message) {
  warnings.push(message);
}

function bool(key) {
  return ['true', '1', 'yes', 'on'].includes(String(process.env[key] || '').toLowerCase());
}

function present(key) {
  const value = String(process.env[key] || '').trim();
  return Boolean(value) && !/^your_/i.test(value) && !/^change_this/i.test(value);
}

function versionParts(version) {
  return String(version || '0').split(/[.-]/).map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  const max = Math.max(a.length, b.length);
  for (let index = 0; index < max; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function requireVersion(packages, name, minimum) {
  const node = packages[`node_modules/${name}`];
  if (!node) return;
  if (compareVersions(node.version, minimum) < 0) {
    addError(`${name} must be at least ${minimum}; lockfile has ${node.version}`);
  }
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch (error) {
    return false;
  }
}

function isLocalUrl(value) {
  try {
    const host = new URL(value).hostname;
    return ['localhost', '127.0.0.1', '::1'].includes(host);
  } catch (error) {
    return false;
  }
}

function strongSecret(key, minimum = 32) {
  const value = String(process.env[key] || '');
  if (value.length < minimum) addError(`${key} must be at least ${minimum} characters for launch`);
}

function strongPassword(key) {
  const value = String(process.env[key] || '');
  if (value.length < 14 || !/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value) || !/[^A-Za-z0-9]/.test(value)) {
    addError(`${key} must be 14+ characters and include uppercase, lowercase, number, and symbol`);
  }
}

function runEnvChecks() {
  try {
    validateEnv();
  } catch (error) {
    addError(error.message);
  }

  if (!env.isProduction) {
    addWarning('NODE_ENV is not production; run npm run launch:check for production readiness.');
    return;
  }

  if (!isHttpsUrl(env.appUrl) || isLocalUrl(env.appUrl)) addError('APP_URL must be a public HTTPS URL');
  if (!isHttpsUrl(env.seo.siteUrl) || isLocalUrl(env.seo.siteUrl)) addError('SITE_URL must be a public HTTPS URL');
  if (/localhost|127\.0\.0\.1/i.test(env.mongoUri)) addError('MONGO_URI must not point to localhost for launch');
  if (!env.mongoTransactions) addError('MONGO_TRANSACTIONS must be true for production launch');

  strongSecret('SESSION_SECRET');
  strongSecret('PAYMENT_WEBHOOK_SECRET');
  strongPassword('SUPER_ADMIN_PASSWORD');

  if (env.paymentProvider !== 'pesapal') addError('PAYMENT_PROVIDER must be pesapal for this launch');
  ['PESAPAL_CONSUMER_KEY', 'PESAPAL_CONSUMER_SECRET'].forEach((key) => {
    if (!present(key)) addError(`${key} is required for live Pesapal payments`);
  });
  if (!present('PESAPAL_IPN_ID') && !present('PESAPAL_IPN_URL')) addError('PESAPAL_IPN_ID or PESAPAL_IPN_URL is required');
  if (!isHttpsUrl(env.paymentProviders.pesapal.callbackUrl)) addError('PESAPAL_CALLBACK_URL must be HTTPS');
  if (env.paymentProviders.pesapal.ipnUrl && !isHttpsUrl(env.paymentProviders.pesapal.ipnUrl)) addError('PESAPAL_IPN_URL must be HTTPS');

  if (!bool('PUSH_ENABLED')) addError('PUSH_ENABLED must be true for launch push notifications');
  ['PUSH_VAPID_PUBLIC_KEY', 'PUSH_VAPID_PRIVATE_KEY'].forEach((key) => {
    if (!present(key)) addError(`${key} is required for launch push notifications`);
  });

  ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM'].forEach((key) => {
    if (!present(key)) addError(`${key} is required for launch email delivery`);
  });

  if (!present('WHATSAPP_ACCESS_TOKEN') && !present('WHATSAPP_API_TOKEN')) addError('WHATSAPP_ACCESS_TOKEN or WHATSAPP_API_TOKEN is required');
  if (!present('WHATSAPP_PHONE_NUMBER_ID') && !present('WHATSAPP_API_URL')) addError('WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_API_URL is required');

  if (!present('GOOGLE_SITE_VERIFICATION')) addWarning('GOOGLE_SITE_VERIFICATION is empty; Google Search Console verification will need manual completion.');
  if (!present('BING_SITE_VERIFICATION')) addWarning('BING_SITE_VERIFICATION is empty; Bing/Microsoft Webmaster verification will need manual completion.');
  if (!present('INDEXNOW_KEY')) addWarning('INDEXNOW_KEY is empty; IndexNow submission will be skipped.');
}

function runDependencyChecks() {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const packages = lock.packages || {};

  if (packages['node_modules/csurf']) addError('csurf is archived and must not be installed');
  requireVersion(packages, 'multer', '2.0.0');
  requireVersion(packages, 'form-data', '4.0.4');
  requireVersion(packages, 'body-parser', '1.20.3');
  requireVersion(packages, 'cookie', '0.7.0');
  requireVersion(packages, 'express', '4.21.2');
  requireVersion(packages, 'path-to-regexp', '0.1.12');
  requireVersion(packages, 'send', '0.19.1');
  requireVersion(packages, 'serve-static', '1.16.2');
  requireVersion(packages, 'cross-spawn', '7.0.5');
  requireVersion(packages, 'braces', '3.0.3');
  requireVersion(packages, 'micromatch', '4.0.8');
  requireVersion(packages, 'minimist', '1.2.8');

  Object.entries(packages).forEach(([name, node]) => {
    if (node?.deprecated && !node.dev) addWarning(`${name.replace('node_modules/', '')} is deprecated: ${node.deprecated}`);
  });
}

runEnvChecks();
runDependencyChecks();

warnings.forEach((message) => console.warn(`[launch-check] warning: ${message}`));

if (errors.length) {
  errors.forEach((message) => console.error(`[launch-check] error: ${message}`));
  process.exit(1);
}

console.log('[launch-check] Production launch checks passed.');

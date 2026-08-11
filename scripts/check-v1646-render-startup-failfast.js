'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const envSource = read('src/config/env.js');
const catalog = read('src/services/marketplace/catalogService.js');
const errors = read('src/middlewares/errorHandler.js');
const repository = read('src/repositories/mongoRepository.js');
const render = read('render.yaml');
const gateSource = read('scripts/check-v1646-render-startup-failfast.js');
const packageJson = require('../package.json');
const checks = [];
const check = (name, ok) => checks.push([name, Boolean(ok)]);

const syntheticValue = (label) => `test-only-${label}-fixture`;
const operatingSystemEnv = {};
['PATH', 'Path', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TMP', 'TEMP'].forEach((key) => {
  if (process.env[key]) operatingSystemEnv[key] = process.env[key];
});

const child = spawnSync(process.execPath, ['-e', "require('./src/config/env').validateEnv(); process.stdout.write('valid')"], {
  cwd: root,
  encoding: 'utf8',
  env: {
    ...operatingSystemEnv,
    NODE_ENV: 'production',
    APP_URL: 'https://www.classictrip.org',
    SITE_URL: 'https://www.classictrip.org',
    MONGO_URI: 'mongodb://example.invalid/classic-trip',
    MONGO_DB_NAME: 'classic-trip',
    MONGO_TRANSACTIONS: 'true',
    SESSION_SECRET: syntheticValue('session'),
    PLATFORM_MFA_ENABLED: 'false',
    CLOUDINARY_CLOUD_NAME: syntheticValue('cloudinary-name'),
    CLOUDINARY_API_KEY: syntheticValue('cloudinary-key'),
    CLOUDINARY_API_SECRET: syntheticValue('cloudinary-secret'),
    PAYMENT_PROVIDER: 'pesapal',
    PAYMENT_WEBHOOK_SECRET: syntheticValue('payment-webhook'),
    PESAPAL_API_URL: 'https://pay.pesapal.com/v3/api',
    PESAPAL_CONSUMER_KEY: syntheticValue('pesapal-key'),
    PESAPAL_CONSUMER_SECRET: syntheticValue('pesapal-secret'),
    PESAPAL_CALLBACK_URL: 'https://www.classictrip.org/booking/payment/callback',
    PESAPAL_IPN_URL: 'https://www.classictrip.org/api/webhooks/payments',
    PESAPAL_NOTIFICATION_TYPE: 'POST',
    SMTP_HOST: 'smtp.example.invalid',
    WHATSAPP_ACCESS_TOKEN: syntheticValue('whatsapp-token'),
    WHATSAPP_PHONE_NUMBER_ID: syntheticValue('whatsapp-phone-id'),
    TAXI_REQUIRE_LIVE_ROUTING: 'false',
    PUSH_ENABLED: 'false',
    REDIS_REQUIRED: 'false',
    SUPER_ADMIN_EMAIL: 'validation@example.invalid',
    SUPER_ADMIN_PASSWORD: syntheticValue('super-admin-password'),
  },
});

check('production Pesapal validateEnv executes without an appUrl ReferenceError', child.status === 0 && child.stdout === 'valid');
check('production public URLs use reusable HTTPS and private-network validation', envSource.includes('function productionHttpsUrl') && envSource.includes("productionHttpsUrl('APP_URL'") && envSource.includes("productionHttpsUrl('PESAPAL_CALLBACK_URL'"));
check('listing responses have a bounded outer Mongo network deadline', catalog.includes('env.performance.publicCatalogDeadlineMs') && catalog.includes("publicCatalogDeadlineError('listing')"));
check('Home cold loads have a shorter degraded-response deadline', catalog.includes('env.performance.homeBootstrapDeadlineMs') && catalog.includes("publicCatalogDeadlineError('Home')"));
check('all full public catalog reads have a bounded outer deadline', catalog.includes("publicCatalogDeadlineError('catalog')") && catalog.includes('return await withDeadline'));
check('Mongo network and server-selection failures become controlled 503 responses', errors.includes('MongoNetworkTimeoutError') && errors.includes('error.status = 503') && errors.includes('database_temporarily_unavailable'));
check('a spent Mongo socket timeout is not retried into a minute-long request', repository.includes("name.includes('mongonetworktimeout')") && repository.includes('return false'));
check('Mongo socket timeout is capped at eight seconds', envSource.includes("Math.min(8000, number('MONGO_SOCKET_TIMEOUT_MS', 8000))") && (render.match(/value: "8000"/g) || []).length >= 2);
check('Render declares both public response deadlines', render.includes('PUBLIC_CATALOG_DB_DEADLINE_MS') && render.includes('HOME_BOOTSTRAP_DEADLINE_MS'));
check('Render worker has one canonical name declaration', (render.match(/name: classic-trip-worker/g) || []).length === 1);
check('startup regression uses no inline Mongo credentials', !/mongodb(?:\+srv)?:\/\/[^/\s:@]+:[^@\s/]+@/i.test(gateSource));
check('startup regression inherits only allowlisted operating-system variables', !gateSource.includes(['...', 'process.env'].join('')));
check('release contains the v1.6.46 startup/fail-fast gate', Number(packageJson.version.split('.')[2]) >= 46);

const failed = checks.filter(([, ok]) => !ok);
checks.forEach(([name, ok]) => console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`));
if (failed.length) {
  if (child.status !== 0) console.error(child.stderr || child.stdout);
  console.error(`Startup/fail-fast checks failed (${checks.length - failed.length}/${checks.length}).`);
  process.exit(1);
}
console.log(`Startup/fail-fast checks passed (${checks.length}/${checks.length}).`);

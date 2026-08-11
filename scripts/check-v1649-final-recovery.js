'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = require('../package.json');
const envSource = read('src/config/env.js');
const server = read('src/server.js');
const catalog = read('src/services/marketplace/catalogService.js');
const redis = read('src/config/redis.js');
const render = read('render.yaml');
const checks = [];
const check = (name, ok) => checks.push([name, Boolean(ok)]);

const operatingSystemEnv = {};
['PATH', 'Path', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TMP', 'TEMP'].forEach((key) => {
  if (process.env[key]) operatingSystemEnv[key] = process.env[key];
});

function productionValidation(overrides = {}) {
  const fixture = (name) => `test-only-${name}-fixture`;
  return spawnSync(process.execPath, ['-e', "require('./src/config/env').validateEnv(); process.stdout.write('valid')"], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...operatingSystemEnv,
      NODE_ENV: 'production',
      APP_URL: 'https://classictrip.org',
      SITE_URL: 'https://www.classictrip.org',
      MONGO_URI: 'mongodb://example.invalid/classic-trip',
      MONGO_DB_NAME: 'classic-trip',
      MONGO_TRANSACTIONS: 'true',
      SESSION_SECRET: fixture('session'),
      PLATFORM_MFA_ENABLED: 'false',
      CLOUDINARY_CLOUD_NAME: fixture('cloudinary-name'),
      CLOUDINARY_API_KEY: fixture('cloudinary-key'),
      CLOUDINARY_API_SECRET: fixture('cloudinary-secret'),
      PAYMENT_PROVIDER: 'pesapal',
      PAYMENT_WEBHOOK_SECRET: fixture('payment-webhook'),
      PESAPAL_API_URL: 'https://pay.pesapal.com/v3/api',
      PESAPAL_CONSUMER_KEY: fixture('pesapal-key'),
      PESAPAL_CONSUMER_SECRET: fixture('pesapal-secret'),
      PESAPAL_CALLBACK_URL: 'https://www.classictrip.org/booking/payment/callback',
      PESAPAL_IPN_URL: 'https://hooks.example.invalid/classic-trip/pesapal',
      PESAPAL_NOTIFICATION_TYPE: 'POST',
      SMTP_HOST: 'smtp.example.invalid',
      WHATSAPP_ACCESS_TOKEN: fixture('whatsapp-token'),
      WHATSAPP_PHONE_NUMBER_ID: fixture('whatsapp-phone-id'),
      TAXI_REQUIRE_LIVE_ROUTING: 'false',
      PUSH_ENABLED: 'false',
      REDIS_REQUIRED: 'false',
      SUPER_ADMIN_EMAIL: 'validation@example.invalid',
      SUPER_ADMIN_PASSWORD: fixture('super-admin-password'),
      ...overrides,
    },
  });
}

const aliasValidation = productionValidation();
const localCallbackValidation = productionValidation({ PESAPAL_CALLBACK_URL: 'https://127.0.0.1/payment/callback' });
const insecureCallbackValidation = productionValidation({ PESAPAL_CALLBACK_URL: 'http://www.classictrip.org/payment/callback' });

check('release is v1.6.50 with the tested Node 24 line pinned', pkg.version === '1.6.50' && pkg.engines?.node === '24.x' && read('.node-version').trim() === '24');
check('www and infrastructure callback aliases no longer stop production startup', aliasValidation.status === 0 && aliasValidation.stdout === 'valid');
check('Pesapal callback still rejects private network destinations', localCallbackValidation.status !== 0 && /local or private network/.test(localCallbackValidation.stderr));
check('Pesapal callback still rejects non-HTTPS delivery', insecureCallbackValidation.status !== 0 && /must use HTTPS/.test(insecureCallbackValidation.stderr));
check('the removed exact APP_URL host rule cannot regress', !envSource.includes('must use HTTPS on the APP_URL host') && !envSource.includes('appUrl.hostname.toLowerCase()'));

const listenIndex = server.indexOf('httpServer = app.listen');
const warmInvocationIndex = server.indexOf('schedulePublicCatalogWarmup();');
check('Render port opens before non-blocking marketplace warmup', listenIndex >= 0 && warmInvocationIndex > listenIndex && server.includes('setImmediate(() =>'));
check('warmup reports success or a bounded deferred warning', server.includes("'Marketplace cache warmed'") && server.includes("'Marketplace cache warmup deferred'"));
check('last successful public inventory is compressed and retained in Redis', catalog.includes("redisRuntime.key('catalog-snapshot', 'public')") && catalog.includes('gzipAsync') && catalog.includes('gunzipAsync') && catalog.includes('CATALOG_EMERGENCY_STALE_MS'));
check('a restarted web process hydrates shared inventory before hitting Mongo', catalog.includes('hydrateSnapshotFromSharedCache') && catalog.includes('if (!options.force && !snapshotCache) await hydrateSnapshotFromSharedCache()'));
check('all full marketplace pages use the outer response deadline', catalog.includes("publicCatalogDeadlineError('catalog')") && catalog.includes('env.performance.publicCatalogDeadlineMs'));
check('cold loading and confirmed database failure use truthful distinct messages', catalog.includes('Live marketplace inventory is loading') && catalog.includes('Live marketplace inventory is temporarily unavailable'));
check('missing Redis is visible in production logs', redis.includes('shared marketplace and session caches are unavailable'));
check('Render blueprint uses clean install, full release gate, npm start, readiness and Redis', render.includes('buildCommand: npm ci && npm run release:check && npm prune --omit=dev') && render.includes('startCommand: npm start') && render.includes('healthCheckPath: /ready') && render.includes('name: classic-trip-cache'));
check('Render and environment example declare the 24-hour emergency snapshot window', render.includes('PUBLIC_CATALOG_EMERGENCY_STALE_MS') && read('.env.example').includes('PUBLIC_CATALOG_EMERGENCY_STALE_MS=86400000'));

const failed = checks.filter(([, ok]) => !ok);
checks.forEach(([name, ok]) => console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`));
if (failed.length) {
  if (aliasValidation.status !== 0) console.error(aliasValidation.stderr || aliasValidation.stdout);
  console.error(`v1.6.50 final recovery checks failed (${checks.length - failed.length}/${checks.length}).`);
  process.exit(1);
}
console.log(`v1.6.50 final recovery checks passed (${checks.length}/${checks.length}).`);

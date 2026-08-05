const path = require('path');
let dotenv = null;
try { dotenv = require('dotenv'); } catch (error) { dotenv = null; }
if (dotenv) dotenv.config({ path: path.join(process.cwd(), '.env') });

const RAW_NODE_ENV = String(process.env.NODE_ENV || 'development').trim().toLowerCase();
const NODE_ENV_ALIASES = Object.freeze({ develoment: 'development', developement: 'development', dev: 'development', prod: 'production' });
const NORMALIZED_NODE_ENV = NODE_ENV_ALIASES[RAW_NODE_ENV] || RAW_NODE_ENV || 'development';
process.env.NODE_ENV = NORMALIZED_NODE_ENV;

const number = (key, fallback) => {
  const value = Number(process.env[key]);
  return Number.isFinite(value) ? value : fallback;
};

const configuredValue = (key) => {
  const value = String(process.env[key] || '').trim();
  if (!value || /^your_/i.test(value) || /^change_this/i.test(value)) return '';
  return value;
};

const booleanFlag = (key, fallback = false) => {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  return ['true', '1', 'yes', 'on'].includes(String(raw).toLowerCase());
};

const csvList = (key, fallback = []) => {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return String(raw).split(',').map((item) => item.trim()).filter(Boolean);
};

const env = {
  appName: process.env.APP_NAME || 'Classic Trip',
  nodeEnv: NORMALIZED_NODE_ENV,
  rawNodeEnv: RAW_NODE_ENV,
  nodeEnvWasNormalized: RAW_NODE_ENV !== NORMALIZED_NODE_ENV,
  isProduction: NORMALIZED_NODE_ENV === 'production',
  port: number('PORT', 5000),
  appUrl: process.env.APP_URL || 'http://localhost:5000',
  mongoUri: process.env.MONGO_URI || '',
  mongoDbName: configuredValue('MONGO_DB_NAME'),
  mongoTransactions: ['true', '1', 'yes'].includes(String(process.env.MONGO_TRANSACTIONS || '').toLowerCase()),
  mongoPool: {
    min: Math.max(0, number('MONGO_MIN_POOL_SIZE', 1)),
    max: Math.max(5, number('MONGO_MAX_POOL_SIZE', 24)),
    maxIdleTimeMs: Math.max(10000, number('MONGO_MAX_IDLE_TIME_MS', 60000)),
    // Keep a meaningful queue window even when an older .env still contains
    // the former 8-second value. Normal traffic should be bounded by the
    // dashboard read limiter; this window absorbs brief Atlas topology changes.
    waitQueueTimeoutMs: Math.max(30000, number('MONGO_WAIT_QUEUE_TIMEOUT_MS', 30000)),
    maxConnecting: Math.max(2, number('MONGO_MAX_CONNECTING', 4)),
  },
  mongoConnection: {
    serverSelectionTimeoutMs: Math.max(30000, number('MONGO_SERVER_SELECTION_TIMEOUT_MS', 30000)),
    connectTimeoutMs: Math.max(30000, number('MONGO_CONNECT_TIMEOUT_MS', 30000)),
    socketTimeoutMs: Math.max(45000, number('MONGO_SOCKET_TIMEOUT_MS', 90000)),
    retryAttempts: Math.max(1, Math.min(8, number('MONGO_CONNECT_RETRY_ATTEMPTS', 5))),
    retryDelayMs: Math.max(250, number('MONGO_CONNECT_RETRY_DELAY_MS', 750)),
    autoIndex: booleanFlag('MONGO_AUTO_INDEX', false),
    ipFamily: [0, 4, 6].includes(number('MONGO_IP_FAMILY', 4)) ? number('MONGO_IP_FAMILY', 4) : 4,
  },
  redis: {
    url: configuredValue('REDIS_URL'),
    prefix: process.env.REDIS_PREFIX || 'classic-trip:',
    required: booleanFlag('REDIS_REQUIRED', false),
    connectTimeoutMs: Math.max(500, number('REDIS_CONNECT_TIMEOUT_MS', 4000)),
  },
  sessionSecret: process.env.SESSION_SECRET || 'dev_classic_trip_secret',
  mfaEncryptionKey: configuredValue('MFA_ENCRYPTION_KEY') || (process.env.NODE_ENV === 'production' ? '' : (process.env.SESSION_SECRET || 'dev_classic_trip_mfa_key')),
  platformMfaEnabled: booleanFlag('PLATFORM_MFA_ENABLED', false),
  mfaSessionMaxAgeMinutes: number('MFA_SESSION_MAX_AGE_MINUTES', 720),
  cloudinary: {
    cloudName: configuredValue('CLOUDINARY_CLOUD_NAME'),
    apiKey: configuredValue('CLOUDINARY_API_KEY'),
    apiSecret: configuredValue('CLOUDINARY_API_SECRET'),
    folder: process.env.CLOUDINARY_FOLDER || 'classic-trip',
    maxUploadSizeMb: number('MAX_UPLOAD_SIZE_MB', 5),
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/auth/google/callback',
  },
  paymentProvider: (process.env.PAYMENT_PROVIDER || 'pesapal').trim().toLowerCase().replace(/-/g, '_'),
  paymentWebhookSecret: configuredValue('PAYMENT_WEBHOOK_SECRET'),
  paymentProviders: {
    pesapal: {
      apiUrl: process.env.PESAPAL_API_URL || process.env.PAYMENT_API_URL || 'https://pay.pesapal.com/v3/api',
      consumerKey: process.env.PESAPAL_CONSUMER_KEY || process.env.PAYMENT_API_KEY || '',
      consumerSecret: process.env.PESAPAL_CONSUMER_SECRET || process.env.PAYMENT_API_SECRET || '',
      callbackUrl: process.env.PESAPAL_CALLBACK_URL || process.env.PAYMENT_CALLBACK_URL || `${process.env.APP_URL || 'http://localhost:5000'}/booking/payment/callback`,
      ipnUrl: process.env.PESAPAL_IPN_URL || process.env.PAYMENT_IPN_URL || `${process.env.APP_URL || 'http://localhost:5000'}/api/webhooks/payments`,
      ipnId: process.env.PESAPAL_IPN_ID || '',
      webhookSecret: process.env.PESAPAL_WEBHOOK_SECRET || process.env.PAYMENT_WEBHOOK_SECRET || '',
      notificationType: process.env.PESAPAL_NOTIFICATION_TYPE || 'POST',
    },
    mtn_momo: {
      apiUrl: process.env.MTN_MOMO_API_URL || process.env.PAYMENT_API_URL || '',
      refundUrl: process.env.MTN_MOMO_REFUND_URL || '',
      apiKey: process.env.MTN_MOMO_API_KEY || process.env.PAYMENT_API_KEY || '',
      callbackUrl: process.env.MTN_MOMO_CALLBACK_URL || process.env.PAYMENT_CALLBACK_URL || '',
      webhookSecret: process.env.MTN_MOMO_WEBHOOK_SECRET || process.env.PAYMENT_WEBHOOK_SECRET || '',
    },
    airtel_money: {
      apiUrl: process.env.AIRTEL_MONEY_API_URL || process.env.PAYMENT_API_URL || '',
      refundUrl: process.env.AIRTEL_MONEY_REFUND_URL || '',
      apiKey: process.env.AIRTEL_MONEY_API_KEY || process.env.PAYMENT_API_KEY || '',
      callbackUrl: process.env.AIRTEL_MONEY_CALLBACK_URL || process.env.PAYMENT_CALLBACK_URL || '',
      webhookSecret: process.env.AIRTEL_MONEY_WEBHOOK_SECRET || process.env.PAYMENT_WEBHOOK_SECRET || '',
    },
    flutterwave: {
      apiUrl: process.env.FLUTTERWAVE_API_URL || process.env.PAYMENT_API_URL || '',
      refundUrl: process.env.FLUTTERWAVE_REFUND_URL || '',
      apiKey: process.env.FLUTTERWAVE_API_KEY || process.env.PAYMENT_API_KEY || '',
      callbackUrl: process.env.FLUTTERWAVE_CALLBACK_URL || process.env.PAYMENT_CALLBACK_URL || '',
      webhookSecret: process.env.FLUTTERWAVE_WEBHOOK_SECRET || process.env.PAYMENT_WEBHOOK_SECRET || '',
    },
    paystack: {
      apiUrl: process.env.PAYSTACK_API_URL || process.env.PAYMENT_API_URL || 'https://api.paystack.co/transaction/initialize',
      refundUrl: process.env.PAYSTACK_REFUND_URL || 'https://api.paystack.co/refund',
      apiKey: process.env.PAYSTACK_API_KEY || process.env.PAYMENT_API_KEY || '',
      callbackUrl: process.env.PAYSTACK_CALLBACK_URL || process.env.PAYMENT_CALLBACK_URL || '',
      webhookSecret: process.env.PAYSTACK_WEBHOOK_SECRET || process.env.PAYMENT_WEBHOOK_SECRET || '',
    },
    dpo: {
      apiUrl: process.env.DPO_API_URL || process.env.PAYMENT_API_URL || '',
      refundUrl: process.env.DPO_REFUND_URL || '',
      apiKey: process.env.DPO_API_KEY || process.env.PAYMENT_API_KEY || '',
      callbackUrl: process.env.DPO_CALLBACK_URL || process.env.PAYMENT_CALLBACK_URL || '',
      webhookSecret: process.env.DPO_WEBHOOK_SECRET || process.env.PAYMENT_WEBHOOK_SECRET || '',
    },
  },
  email: {
    from: process.env.EMAIL_FROM || 'no-reply@classictrip.com',
    host: process.env.SMTP_HOST || '',
    port: process.env.SMTP_PORT || '',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
  sms: {
    apiUrl: process.env.SMS_API_URL || '',
    apiToken: process.env.SMS_API_TOKEN || '',
    from: process.env.SMS_FROM || process.env.APP_NAME || 'Classic Trip',
  },
  whatsapp: {
    provider: process.env.WHATSAPP_PROVIDER || 'meta',
    apiUrl: process.env.WHATSAPP_API_URL || '',
    apiToken: process.env.WHATSAPP_API_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN || '',
    from: process.env.WHATSAPP_FROM || process.env.APP_NAME || 'Classic Trip',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
    graphVersion: process.env.WHATSAPP_GRAPH_VERSION || 'v20.0',
  },
  maps: {
    tileUrl: process.env.MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    tileAttribution: process.env.MAP_TILE_ATTRIBUTION || '&copy; OpenStreetMap contributors',
    defaultLatitude: number('MAP_DEFAULT_LATITUDE', 0.3476),
    defaultLongitude: number('MAP_DEFAULT_LONGITUDE', 32.5825),
    defaultZoom: number('MAP_DEFAULT_ZOOM', 12),
    routingApiUrl: configuredValue('TAXI_ROUTING_API_URL') || (process.env.NODE_ENV === 'production' ? '' : 'https://router.project-osrm.org'),
    routingProfile: process.env.TAXI_ROUTING_PROFILE || 'driving',
    routingTimeoutMs: number('TAXI_ROUTING_TIMEOUT_MS', 8000),
    requireLiveRouting: booleanFlag('TAXI_REQUIRE_LIVE_ROUTING', process.env.NODE_ENV === 'production'),
  },
  push: {
    enabled: booleanFlag('PUSH_ENABLED', false),
    vapidPublicKey: process.env.PUSH_VAPID_PUBLIC_KEY || '',
    vapidPrivateKey: process.env.PUSH_VAPID_PRIVATE_KEY || '',
    subject: process.env.PUSH_VAPID_SUBJECT || `mailto:${process.env.SUPPORT_EMAIL || 'support@classictrip.com'}`,
  },
  seo: {
    siteUrl: process.env.SITE_URL || process.env.APP_URL || 'http://localhost:5000',
    defaultTitle: process.env.SEO_DEFAULT_TITLE || 'Classic Trip | East Africa travel marketplace',
    defaultDescription: process.env.SEO_DEFAULT_DESCRIPTION || 'Book buses, hotels, agent-supported flights and verified local rides across East Africa with Classic Trip.',
    defaultImage: process.env.SEO_DEFAULT_IMAGE || '',
    googleSiteVerification: process.env.GOOGLE_SITE_VERIFICATION || '',
    bingSiteVerification: process.env.BING_SITE_VERIFICATION || '',
    allowAiTraining: booleanFlag('SEO_ALLOW_AI_TRAINING', false),
    allowAiSearch: booleanFlag('SEO_ALLOW_AI_SEARCH', true),
    indexNowKey: process.env.INDEXNOW_KEY || '',
    publicSitemapExtraUrls: csvList('SEO_EXTRA_URLS'),
  },
  superAdmin: {
    email: configuredValue('SUPER_ADMIN_EMAIL'),
    password: configuredValue('SUPER_ADMIN_PASSWORD'),
    fullName: process.env.SUPER_ADMIN_NAME || 'Classic Trip Super Admin',
    phone: configuredValue('SUPER_ADMIN_PHONE'),
  },
  performance: {
    logSlowRequests: booleanFlag('LOG_SLOW_REQUESTS', NORMALIZED_NODE_ENV === 'production'),
    slowRequestThresholdMs: number('SLOW_REQUEST_THRESHOLD_MS', 2000),
    homeCacheTtlMs: number('HOME_CACHE_TTL_MS', 60000),
    homeCacheStaleMs: number('HOME_CACHE_STALE_MS', 300000),
    dashboardCacheTtlMs: number('DASHBOARD_SNAPSHOT_TTL_MS', 60000),
    dashboardCacheStaleMs: number('DASHBOARD_SNAPSHOT_STALE_MS', 300000),
    dashboardReadConcurrency: number('DASHBOARD_DB_READ_CONCURRENCY', 4),
    // Global admission limit for heavy Mongo reads across *all* concurrent
    // dashboard/catalog requests. This is intentionally separate from each
    // snapshot's local worker count so page navigation cannot exhaust the pool.
    mongoReadConcurrency: Math.max(2, number('MONGO_READ_CONCURRENCY', 6)),
  },
  jobs: {
    enabled: booleanFlag('ENABLE_JOBS', NORMALIZED_NODE_ENV === 'production'),
    cleanupExpiredLocks: process.env.JOB_CLEANUP_EXPIRED_LOCKS || '*/5 * * * *',
    processOutbox: process.env.JOB_PROCESS_OUTBOX || '*/10 * * * * *',
    expirePaymentIntents: process.env.JOB_EXPIRE_PAYMENT_INTENTS || '*/5 * * * *',
    releaseCommission: process.env.JOB_RELEASE_COMMISSION || '*/10 * * * *',
    bookingReminders: process.env.JOB_BOOKING_REMINDERS || '*/15 * * * *',
    expirePromotions: process.env.JOB_EXPIRE_PROMOTIONS || '*/30 * * * *',
    payoutReports: process.env.JOB_PAYOUT_REPORTS || '0 6 * * *',
    materializeSchedules: process.env.JOB_MATERIALIZE_SCHEDULES || '0 3 * * *',
    dispatchTaxiRides: process.env.JOB_DISPATCH_TAXI_RIDES || '* * * * *',
    expireFlightHolds: process.env.JOB_EXPIRE_FLIGHT_HOLDS || '*/2 * * * *',
    purgeArchivedRecords: process.env.JOB_PURGE_ARCHIVED_RECORDS || '30 4 * * *',
  },
};

function validateEnv() {
  const supportedNodeEnvs = new Set(['development', 'test', 'production']);
  if (!supportedNodeEnvs.has(env.nodeEnv)) throw new Error(`NODE_ENV must be development, test, or production (received "${env.rawNodeEnv || env.nodeEnv}")`);
  const requiredAlways = ['MONGO_URI', 'SESSION_SECRET'];
  const missingAlways = requiredAlways.filter((key) => !configuredValue(key));
  if (missingAlways.length) throw new Error(`Missing required environment variables: ${missingAlways.join(', ')}`);
  const requiredInProduction = [
    'SESSION_SECRET',
    ...(env.platformMfaEnabled ? ['MFA_ENCRYPTION_KEY'] : []),
    'MONGO_URI',
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
    'PAYMENT_WEBHOOK_SECRET',
    'SUPER_ADMIN_EMAIL',
    'SUPER_ADMIN_PASSWORD',
  ];
  // Use configuredValue() (not raw process.env truthiness) so a placeholder left over from
  // .env.example, e.g. CLOUDINARY_CLOUD_NAME=your_cloud_name or
  // PAYMENT_WEBHOOK_SECRET=change_this_webhook_secret, fails the boot check instead of
  // silently passing and breaking uploads or webhook auth at runtime.
  const missing = requiredInProduction.filter((key) => !configuredValue(key));
  if (env.isProduction && missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  if (env.isProduction) {
    let appUrl;
    try { appUrl = new URL(env.appUrl); } catch (error) { throw new Error('APP_URL must be a valid absolute URL'); }
    if (appUrl.protocol !== 'https:') throw new Error('APP_URL must use HTTPS in production');
    let siteUrl;
    try { siteUrl = new URL(env.seo.siteUrl); } catch (error) { throw new Error('SITE_URL must be a valid absolute URL'); }
    if (siteUrl.protocol !== 'https:') throw new Error('SITE_URL must use HTTPS in production');
  }
  if (env.redis.required && !env.redis.url) {
    throw new Error('REDIS_URL is required when REDIS_REQUIRED=true');
  }
  if (env.redis.url) {
    let redisUrl;
    try { redisUrl = new URL(env.redis.url); } catch (error) { throw new Error('REDIS_URL must be a valid Redis connection URL'); }
    if (!['redis:', 'rediss:'].includes(redisUrl.protocol)) throw new Error('REDIS_URL must use redis:// or rediss://');
  }
  if (env.maps.routingApiUrl) {
    let routingUrl;
    try { routingUrl = new URL(env.maps.routingApiUrl); } catch (error) { throw new Error('TAXI_ROUTING_API_URL must be a valid absolute URL'); }
    if (env.isProduction && routingUrl.protocol !== 'https:') throw new Error('TAXI_ROUTING_API_URL must use HTTPS in production');
    const blockedRoutingHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);
    if (env.isProduction && blockedRoutingHosts.has(routingUrl.hostname.toLowerCase())) throw new Error('TAXI_ROUTING_API_URL cannot target a local address in production');
  }
  if (env.isProduction && env.maps.requireLiveRouting && !env.maps.routingApiUrl) {
    throw new Error('TAXI_ROUTING_API_URL is required when TAXI_REQUIRE_LIVE_ROUTING=true');
  }
  if (env.isProduction && !env.mongoTransactions) {
    throw new Error('MONGO_TRANSACTIONS=true is required in production');
  }
  if (env.isProduction && env.sessionSecret === 'dev_classic_trip_secret') {
    throw new Error('SESSION_SECRET must be set to a production value');
  }
  if (env.isProduction && env.push.enabled && (!env.push.vapidPublicKey || !env.push.vapidPrivateKey)) {
    throw new Error('PUSH_VAPID_PUBLIC_KEY and PUSH_VAPID_PRIVATE_KEY are required when PUSH_ENABLED=true');
  }
  if (env.isProduction && !env.email.host) {
    throw new Error('SMTP_HOST is required for production email notifications');
  }
  if (env.isProduction && (!env.whatsapp.apiToken || (!env.whatsapp.apiUrl && !env.whatsapp.phoneNumberId))) {
    throw new Error('WhatsApp production delivery requires WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_API_URL');
  }
  const activeProvider = env.paymentProviders[env.paymentProvider];
  if (env.isProduction && !activeProvider) {
    throw new Error(`Unsupported PAYMENT_PROVIDER "${env.paymentProvider}"`);
  }
  if (env.isProduction && env.paymentProvider === 'pesapal') {
    const missingPesapal = [];
    if (!activeProvider.consumerKey) missingPesapal.push('PESAPAL_CONSUMER_KEY');
    if (!activeProvider.consumerSecret) missingPesapal.push('PESAPAL_CONSUMER_SECRET');
    if (!activeProvider.callbackUrl) missingPesapal.push('PESAPAL_CALLBACK_URL');
    if (!activeProvider.ipnId && !activeProvider.ipnUrl) missingPesapal.push('PESAPAL_IPN_ID or PESAPAL_IPN_URL');
    if (missingPesapal.length) throw new Error(`Missing Pesapal configuration: ${missingPesapal.join(', ')}`);
  } else if (env.isProduction) {
    const missingProvider = [];
    if (!activeProvider.apiUrl) missingProvider.push(`${env.paymentProvider.toUpperCase()}_API_URL`);
    if (!activeProvider.apiKey) missingProvider.push(`${env.paymentProvider.toUpperCase()}_API_KEY`);
    if (missingProvider.length) throw new Error(`Missing payment provider configuration: ${missingProvider.join(', ')}`);
  }
  return true;
}

module.exports = { env, validateEnv };

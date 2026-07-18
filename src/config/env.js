const path = require('path');
let dotenv = null;
try { dotenv = require('dotenv'); } catch (error) { dotenv = null; }
if (dotenv) dotenv.config({ path: path.join(process.cwd(), '.env') });

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

const isTestEnv = process.env.NODE_ENV === 'test';

const env = {
  appName: process.env.APP_NAME || 'Classic Trip',
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  demoMode: ['true', '1', 'yes'].includes(String(process.env.DEMO_MODE || '').toLowerCase()) || process.env.NODE_ENV === 'test',
  port: number('PORT', 5000),
  appUrl: process.env.APP_URL || 'http://localhost:5000',
  mongoUri: process.env.MONGO_URI || '',
  mongoTransactions: ['true', '1', 'yes'].includes(String(process.env.MONGO_TRANSACTIONS || '').toLowerCase()),
  sessionSecret: process.env.SESSION_SECRET || 'dev_classic_trip_secret',
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
  paymentProvider: process.env.NODE_ENV === 'test' ? 'mock' : (process.env.PAYMENT_PROVIDER || 'mock'),
  paymentWebhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || 'dev_webhook_secret',
  allowMockPayments: isTestEnv ? true : booleanFlag('ALLOW_MOCK_PAYMENTS', process.env.NODE_ENV !== 'production'),
  paymentProviders: {
    mock: { enabled: true },
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
      apiKey: process.env.MTN_MOMO_API_KEY || process.env.PAYMENT_API_KEY || '',
      callbackUrl: process.env.MTN_MOMO_CALLBACK_URL || process.env.PAYMENT_CALLBACK_URL || '',
      webhookSecret: process.env.MTN_MOMO_WEBHOOK_SECRET || process.env.PAYMENT_WEBHOOK_SECRET || '',
    },
    airtel_money: {
      apiUrl: process.env.AIRTEL_MONEY_API_URL || process.env.PAYMENT_API_URL || '',
      apiKey: process.env.AIRTEL_MONEY_API_KEY || process.env.PAYMENT_API_KEY || '',
      callbackUrl: process.env.AIRTEL_MONEY_CALLBACK_URL || process.env.PAYMENT_CALLBACK_URL || '',
      webhookSecret: process.env.AIRTEL_MONEY_WEBHOOK_SECRET || process.env.PAYMENT_WEBHOOK_SECRET || '',
    },
    flutterwave: {
      apiUrl: process.env.FLUTTERWAVE_API_URL || process.env.PAYMENT_API_URL || '',
      apiKey: process.env.FLUTTERWAVE_API_KEY || process.env.PAYMENT_API_KEY || '',
      callbackUrl: process.env.FLUTTERWAVE_CALLBACK_URL || process.env.PAYMENT_CALLBACK_URL || '',
      webhookSecret: process.env.FLUTTERWAVE_WEBHOOK_SECRET || process.env.PAYMENT_WEBHOOK_SECRET || '',
    },
    paystack: {
      apiUrl: process.env.PAYSTACK_API_URL || process.env.PAYMENT_API_URL || '',
      apiKey: process.env.PAYSTACK_API_KEY || process.env.PAYMENT_API_KEY || '',
      callbackUrl: process.env.PAYSTACK_CALLBACK_URL || process.env.PAYMENT_CALLBACK_URL || '',
      webhookSecret: process.env.PAYSTACK_WEBHOOK_SECRET || process.env.PAYMENT_WEBHOOK_SECRET || '',
    },
    dpo: {
      apiUrl: process.env.DPO_API_URL || process.env.PAYMENT_API_URL || '',
      apiKey: process.env.DPO_API_KEY || process.env.PAYMENT_API_KEY || '',
      callbackUrl: process.env.DPO_CALLBACK_URL || process.env.PAYMENT_CALLBACK_URL || '',
      webhookSecret: process.env.DPO_WEBHOOK_SECRET || process.env.PAYMENT_WEBHOOK_SECRET || '',
    },
  },
  commission: {
    platform: number('PLATFORM_COMMISSION', 10),
    promoter: number('PROMOTER_COMMISSION', 3),
    platformWithPromoter: number('PLATFORM_WITH_PROMOTER_COMMISSION', 7),
    company: number('COMPANY_COMMISSION', 90),
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
  push: {
    enabled: booleanFlag('PUSH_ENABLED', false),
    vapidPublicKey: process.env.PUSH_VAPID_PUBLIC_KEY || '',
    vapidPrivateKey: process.env.PUSH_VAPID_PRIVATE_KEY || '',
    subject: process.env.PUSH_VAPID_SUBJECT || `mailto:${process.env.SUPPORT_EMAIL || 'support@classictrip.com'}`,
  },
  seo: {
    siteUrl: process.env.SITE_URL || process.env.APP_URL || 'http://localhost:5000',
    defaultTitle: process.env.SEO_DEFAULT_TITLE || 'Classic Trip | East Africa travel marketplace',
    defaultDescription: process.env.SEO_DEFAULT_DESCRIPTION || 'Book buses, hotels, routes, tickets, and partner travel services across East Africa with Classic Trip.',
    defaultImage: process.env.SEO_DEFAULT_IMAGE || '',
    googleSiteVerification: process.env.GOOGLE_SITE_VERIFICATION || '',
    bingSiteVerification: process.env.BING_SITE_VERIFICATION || '',
    allowAiTraining: booleanFlag('SEO_ALLOW_AI_TRAINING', false),
    allowAiSearch: booleanFlag('SEO_ALLOW_AI_SEARCH', true),
    indexNowKey: process.env.INDEXNOW_KEY || '',
    publicSitemapExtraUrls: csvList('SEO_EXTRA_URLS'),
  },
  superAdmin: {
    email: process.env.SUPER_ADMIN_EMAIL || 'admin@classictrip.test',
    password: process.env.SUPER_ADMIN_PASSWORD || process.env.DEMO_PASSWORD || 'Password123',
    fullName: process.env.SUPER_ADMIN_NAME || 'Classic Trip Admin',
    phone: process.env.SUPER_ADMIN_PHONE || '+256700000001',
  },
  jobs: {
    enabled: booleanFlag('ENABLE_JOBS', process.env.NODE_ENV === 'production'),
    cleanupExpiredLocks: process.env.JOB_CLEANUP_EXPIRED_LOCKS || '*/5 * * * *',
    expirePaymentIntents: process.env.JOB_EXPIRE_PAYMENT_INTENTS || '*/5 * * * *',
    releaseCommission: process.env.JOB_RELEASE_COMMISSION || '*/10 * * * *',
    bookingReminders: process.env.JOB_BOOKING_REMINDERS || '*/15 * * * *',
    expirePromotions: process.env.JOB_EXPIRE_PROMOTIONS || '*/30 * * * *',
    payoutReports: process.env.JOB_PAYOUT_REPORTS || '0 6 * * *',
  },
  demoPassword: isTestEnv ? 'Password123' : (process.env.DEMO_PASSWORD || 'Password123'),
  // Require explicit opt-in everywhere (not just literal NODE_ENV=production) so a staging
  // box, or a dev box with a typo'd/unset NODE_ENV, doesn't fail open into a universal
  // demo-password login bypass.
  allowDemoLogin: isTestEnv ? true : booleanFlag('ALLOW_DEMO_LOGIN', false),
};

function validateEnv() {
  const requiredInProduction = [
    'SESSION_SECRET',
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
  if (env.isProduction && env.sessionSecret === 'dev_classic_trip_secret') {
    throw new Error('SESSION_SECRET must be set to a production value');
  }
  if (env.isProduction && env.demoMode) {
    throw new Error('DEMO_MODE must be disabled in production');
  }
  if (env.isProduction && env.allowDemoLogin) {
    throw new Error('ALLOW_DEMO_LOGIN must be disabled in production');
  }
  if (env.isProduction && env.demoPassword === 'Password123') {
    throw new Error('DEMO_PASSWORD must be changed from the default production value');
  }
  if (env.isProduction && env.superAdmin.email === 'admin@classictrip.test') {
    throw new Error('SUPER_ADMIN_EMAIL must be set to a real production admin email');
  }
  if (env.isProduction && ['Password123', 'change_this_demo_password'].includes(env.superAdmin.password)) {
    throw new Error('SUPER_ADMIN_PASSWORD must be set to a strong production password');
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
  if (env.isProduction && (env.paymentProvider === 'mock' || env.allowMockPayments)) {
    throw new Error('Mock payments are not allowed in production. Set PAYMENT_PROVIDER=pesapal or another live provider.');
  }
  if (env.isProduction && booleanFlag('AUTO_SEED_MONGO', false)) {
    throw new Error('AUTO_SEED_MONGO must be disabled in production');
  }
  if (env.isProduction && booleanFlag('SEED_READ_MODEL', false)) {
    throw new Error('SEED_READ_MODEL must be disabled in production');
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
  } else if (env.isProduction && env.paymentProvider !== 'mock') {
    const missingProvider = [];
    if (!activeProvider.apiUrl) missingProvider.push(`${env.paymentProvider.toUpperCase()}_API_URL`);
    if (!activeProvider.apiKey) missingProvider.push(`${env.paymentProvider.toUpperCase()}_API_KEY`);
    if (missingProvider.length) throw new Error(`Missing payment provider configuration: ${missingProvider.join(', ')}`);
  }
  return true;
}

module.exports = { env, validateEnv };

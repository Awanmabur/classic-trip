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

const env = {
  appName: process.env.APP_NAME || 'Classic Trip',
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: number('PORT', 5000),
  appUrl: process.env.APP_URL || 'http://localhost:5000',
  mongoUri: process.env.MONGO_URI || '',
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
  paymentProvider: process.env.PAYMENT_PROVIDER || 'mock',
  paymentWebhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || 'dev_webhook_secret',
  paymentProviders: {
    mock: { enabled: true },
    mtn_momo: {
      apiUrl: process.env.MTN_MOMO_API_URL || process.env.PAYMENT_API_URL || '',
      apiKey: process.env.MTN_MOMO_API_KEY || process.env.PAYMENT_API_KEY || '',
      callbackUrl: process.env.MTN_MOMO_CALLBACK_URL || process.env.PAYMENT_CALLBACK_URL || '',
    },
    airtel_money: {
      apiUrl: process.env.AIRTEL_MONEY_API_URL || process.env.PAYMENT_API_URL || '',
      apiKey: process.env.AIRTEL_MONEY_API_KEY || process.env.PAYMENT_API_KEY || '',
      callbackUrl: process.env.AIRTEL_MONEY_CALLBACK_URL || process.env.PAYMENT_CALLBACK_URL || '',
    },
    flutterwave: {
      apiUrl: process.env.FLUTTERWAVE_API_URL || process.env.PAYMENT_API_URL || '',
      apiKey: process.env.FLUTTERWAVE_API_KEY || process.env.PAYMENT_API_KEY || '',
      callbackUrl: process.env.FLUTTERWAVE_CALLBACK_URL || process.env.PAYMENT_CALLBACK_URL || '',
    },
    paystack: {
      apiUrl: process.env.PAYSTACK_API_URL || process.env.PAYMENT_API_URL || '',
      apiKey: process.env.PAYSTACK_API_KEY || process.env.PAYMENT_API_KEY || '',
      callbackUrl: process.env.PAYSTACK_CALLBACK_URL || process.env.PAYMENT_CALLBACK_URL || '',
    },
    dpo: {
      apiUrl: process.env.DPO_API_URL || process.env.PAYMENT_API_URL || '',
      apiKey: process.env.DPO_API_KEY || process.env.PAYMENT_API_KEY || '',
      callbackUrl: process.env.DPO_CALLBACK_URL || process.env.PAYMENT_CALLBACK_URL || '',
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
    apiUrl: process.env.WHATSAPP_API_URL || '',
    apiToken: process.env.WHATSAPP_API_TOKEN || '',
    from: process.env.WHATSAPP_FROM || process.env.APP_NAME || 'Classic Trip',
  },
  jobs: {
    enabled: ['true', '1', 'yes'].includes(String(process.env.ENABLE_JOBS || '').toLowerCase()) || process.env.NODE_ENV === 'production',
    cleanupExpiredLocks: process.env.JOB_CLEANUP_EXPIRED_LOCKS || '*/5 * * * *',
    releaseCommission: process.env.JOB_RELEASE_COMMISSION || '*/10 * * * *',
    bookingReminders: process.env.JOB_BOOKING_REMINDERS || '*/15 * * * *',
    expirePromotions: process.env.JOB_EXPIRE_PROMOTIONS || '*/30 * * * *',
    payoutReports: process.env.JOB_PAYOUT_REPORTS || '0 6 * * *',
  },
  demoPassword: process.env.DEMO_PASSWORD || 'Password123',
};

function validateEnv() {
  const requiredInProduction = [
    'SESSION_SECRET',
    'MONGO_URI',
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
    'PAYMENT_WEBHOOK_SECRET',
  ];
  const missing = requiredInProduction.filter((key) => !process.env[key]);
  if (env.isProduction && missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  if (env.isProduction && env.sessionSecret === 'dev_classic_trip_secret') {
    throw new Error('SESSION_SECRET must be set to a production value');
  }
  return true;
}

module.exports = { env, validateEnv };

const path = require('path');
let dotenv = null;
try { dotenv = require('dotenv'); } catch (error) { dotenv = null; }
if (dotenv) dotenv.config({ path: path.join(process.cwd(), '.env') });

const number = (key, fallback) => {
  const value = Number(process.env[key]);
  return Number.isFinite(value) ? value : fallback;
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
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
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
  demoPassword: process.env.DEMO_PASSWORD || 'Password123',
};

function validateEnv() {
  const requiredInProduction = ['SESSION_SECRET', 'MONGO_URI'];
  const missing = requiredInProduction.filter((key) => !process.env[key]);
  if (env.isProduction && missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  return true;
}

module.exports = { env, validateEnv };

const rateLimit = require('express-rate-limit');
const { env } = require('../config/env');
const { MongoRateLimitStore } = require('./mongoRateLimitStore');

const isTest = process.env.NODE_ENV === 'test';

function productionStore(scope) {
  // Development remains easy to run with the library's process-local store. Production
  // always uses MongoDB so limits are shared by every application instance and fail closed
  // if the security datastore is unavailable.
  return env.isProduction && env.mongoUri ? new MongoRateLimitStore(scope) : undefined;
}

function createLimiter(scope, { windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    skip: () => isTest,
    standardHeaders: true,
    legacyHeaders: false,
    passOnStoreError: false,
    store: productionStore(scope),
    message: { error: message },
  });
}

const authLimiter = createLimiter('auth', {
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: 'Too many attempts, please try again after 15 minutes.',
});

const forgotPasswordLimiter = createLimiter('password_reset', {
  windowMs: 15 * 60 * 1000,
  limit: 5,
  message: 'Too many password reset requests, please try again after 15 minutes.',
});

const paymentLimiter = createLimiter('payment', {
  windowMs: 15 * 60 * 1000,
  limit: 30,
  message: 'Too many payment requests, please slow down.',
});

const ticketLimiter = createLimiter('ticket_lookup', {
  windowMs: 15 * 60 * 1000,
  limit: 40,
  message: 'Too many ticket lookup requests, please try again later.',
});

const webhookLimiter = createLimiter('payment_webhook', {
  windowMs: 5 * 60 * 1000,
  limit: 120,
  message: 'Too many webhook requests.',
});

const sensitiveActionLimiter = createLimiter('sensitive_action', {
  windowMs: 15 * 60 * 1000,
  limit: 60,
  message: 'Too many requests, please slow down.',
});

const publicWriteLimiter = createLimiter('public_write', {
  windowMs: 15 * 60 * 1000,
  limit: 20,
  message: 'Too many submissions, please try again later.',
});

const publicReadLimiter = createLimiter('public_api_read', {
  windowMs: 5 * 60 * 1000,
  limit: 300,
  message: 'Too many requests, please slow down.',
});

module.exports = {
  authLimiter,
  forgotPasswordLimiter,
  paymentLimiter,
  ticketLimiter,
  webhookLimiter,
  sensitiveActionLimiter,
  publicWriteLimiter,
  publicReadLimiter,
};

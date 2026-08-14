const rateLimit = require('express-rate-limit');
const { env } = require('../config/env');
const { MongoRateLimitStore } = require('./mongoRateLimitStore');
const { RedisRateLimitStore } = require('./redisRateLimitStore');
const redisRuntime = require('../config/redis');

const isTest = process.env.NODE_ENV === 'test';

function productionStore(scope) {
  // Redis keeps security counters shared without spending a MongoDB pool
  // connection on every login, form submit, and API read. MongoDB remains the
  // durable fail-closed fallback during a Redis outage.
  if (!env.isProduction) return undefined;
  if (redisRuntime.activeClient()) return new RedisRateLimitStore(scope);
  return env.mongoUri ? new MongoRateLimitStore(scope) : undefined;
}

function wantsJson(req) {
  return String(req.originalUrl || req.path || '').startsWith('/api/')
    || req.xhr
    || String(req.headers.accept || '').includes('application/json');
}

function safeRateLimitRedirect(req, scope) {
  if (scope === 'auth' || scope === 'login_daily_ip' || scope === 'password_reset') return '/login?error=rate_limited';
  const referer = String(req.get('referer') || '');
  try {
    const url = new URL(referer);
    if (url.host === req.get('host')) return `${url.pathname}${url.search || ''}`;
  } catch (_) {}
  return '/';
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
    handler: (req, res) => {
      if (wantsJson(req)) return res.status(429).json({ error: message });
      if (req.flash) req.flash('error', message);
      return res.redirect(safeRateLimitRedirect(req, scope));
    },
  });
}

const authLimiter = createLimiter('auth', {
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: 'Too many attempts, please try again after 15 minutes.',
});

const loginDailyLimiter = createLimiter('login_daily_ip', {
  windowMs: 24 * 60 * 60 * 1000,
  limit: 100,
  message: 'Too many login attempts from this network today. Please try again later or contact support.',
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
  loginDailyLimiter,
  forgotPasswordLimiter,
  paymentLimiter,
  ticketLimiter,
  webhookLimiter,
  sensitiveActionLimiter,
  publicWriteLimiter,
  publicReadLimiter,
};

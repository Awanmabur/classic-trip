const rateLimit = require('express-rate-limit');

const isTest = process.env.NODE_ENV === 'test';

// Brute-force protection for login / register / password flows: 10 attempts per 15 min per IP.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skip: () => isTest,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again after 15 minutes.' },
});

// Stricter limiter for password-reset requests to prevent email flooding: 5 per 15 min.
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skip: () => isTest,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset requests, please try again after 15 minutes.' },
});

// Payment and checkout flows: 30 per 15 min per IP.
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  skip: () => isTest,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many payment requests, please slow down.' },
});

module.exports = { authLimiter, forgotPasswordLimiter, paymentLimiter };

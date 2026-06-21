const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SKIPPED_PATHS = [
  /^\/api\/webhooks\//,
  /^\/auth\/google(?:\/callback)?$/,
];

const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, matches session cookie

function shouldSkip(req) {
  if (process.env.NODE_ENV === 'test') return true;
  if (SAFE_METHODS.has(req.method)) return true;
  return SKIPPED_PATHS.some((pattern) => pattern.test(req.path));
}

function ensureToken(req) {
  if (!req.session) return '';
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  return req.session.csrfToken;
}

function submittedToken(req) {
  return req.body?._csrf
    || req.query?._csrf
    || req.headers['x-csrf-token']
    || req.headers['x-xsrf-token']
    || '';
}

function timingSafeEqual(a, b) {
  if (!a || !b) return false;
  try {
    const aBuf = Buffer.from(String(a));
    const bBuf = Buffer.from(String(b));
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

function csrfToken(req, res, next) {
  const token = ensureToken(req);
  res.locals.csrfToken = token;

  if (token) {
    res.cookie('XSRF-TOKEN', token, {
      httpOnly: false,
      sameSite: 'lax',
      secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
      maxAge: COOKIE_MAX_AGE_MS,
    });
  }

  if (shouldSkip(req)) return next();

  if (timingSafeEqual(submittedToken(req), token)) return next();

  const error = new Error('Invalid or missing CSRF token');
  error.status = 403;
  return next(error);
}

module.exports = { csrfToken };

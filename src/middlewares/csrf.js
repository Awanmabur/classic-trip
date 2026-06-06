const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SKIPPED_PATHS = [
  /^\/api\/webhooks\//,
  /^\/auth\/google(?:\/callback)?$/,
];

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

function csrfToken(req, res, next) {
  const token = ensureToken(req);
  res.locals.csrfToken = token;

  if (token) {
    res.cookie('XSRF-TOKEN', token, {
      httpOnly: false,
      sameSite: 'lax',
      secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    });
  }

  if (shouldSkip(req)) return next();

  if (submittedToken(req) === token) return next();

  const error = new Error('Invalid or missing CSRF token');
  error.status = 403;
  return next(error);
}

module.exports = { csrfToken };

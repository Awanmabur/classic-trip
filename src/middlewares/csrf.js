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

function isMultipartRequest(req) {
  return /^multipart\/form-data(?:;|$)/i.test(String(req.headers['content-type'] || ''));
}

function headerSubmittedToken(req) {
  return req.headers['x-csrf-token'] || req.headers['x-xsrf-token'] || '';
}

function normalizeOrigin(value) {
  const candidate = String(value || '').trim();
  if (!candidate || candidate === 'null') return '';
  try { return new URL(candidate).origin; } catch { return ''; }
}

function expectedRequestOrigin(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || (req.secure ? 'https' : 'http');
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwardedHost || String(req.headers.host || '').trim();
  return host ? normalizeOrigin(`${protocol}://${host}`) : '';
}

function suppliedRequestOrigin(req) {
  const origin = normalizeOrigin(req.headers.origin);
  if (origin) return origin;
  const referer = String(req.headers.referer || '').trim();
  return normalizeOrigin(referer);
}

function isSameOriginRequest(req) {
  const expected = expectedRequestOrigin(req);
  const supplied = suppliedRequestOrigin(req);
  return Boolean(expected && supplied && timingSafeEqual(supplied, expected));
}

function rejectCsrf(next, reason = 'token_mismatch') {
  const error = new Error('Invalid or missing CSRF token');
  error.status = 403;
  error.code = 'invalid_csrf_token';
  error.reason = reason;
  return next(error);
}

function validateSubmittedToken(req, next) {
  const expected = ensureToken(req);
  if (timingSafeEqual(submittedToken(req), expected)) return next();
  return rejectCsrf(next, submittedToken(req) ? 'token_mismatch' : 'token_missing');
}

/**
 * Route-level verifier for multipart requests.
 *
 * Express' urlencoded/json parsers intentionally do not consume multipart bodies.
 * Multer must therefore parse the form first, after which this middleware validates
 * the hidden `_csrf` field (or an explicit CSRF header) before the controller runs.
 */
function requireCsrfToken(req, res, next) {
  if (shouldSkip(req) || req.csrfValidationComplete === true) return next();
  return validateSubmittedToken(req, next);
}

function csrfToken(req, res, next) {
  const token = ensureToken(req);
  req.csrfToken = () => token;
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

  // Multipart fields are unavailable until Multer runs at the route level. A
  // trusted explicit header can be validated before parsing. Native browser
  // forms with an Origin/Referer must pass a strict same-origin check. The
  // hidden `_csrf` field is always validated after Multer parses the form.
  if (isMultipartRequest(req)) {
    const headerToken = headerSubmittedToken(req);
    if (headerToken) {
      if (!timingSafeEqual(headerToken, token)) return rejectCsrf(next, 'header_token_mismatch');
      req.csrfValidationComplete = true;
      return next();
    }
    // Browsers and privacy tools may omit Origin/Referer. In that case, defer to
    // the cryptographic token check after Multer. Explicit cross-origin requests
    // are still rejected before file parsing.
    if (suppliedRequestOrigin(req) && !isSameOriginRequest(req)) return rejectCsrf(next, 'origin_mismatch');
    req.csrfValidationDeferred = true;
    return next();
  }

  return validateSubmittedToken(req, next);
}

module.exports = {
  csrfToken,
  requireCsrfToken,
  ensureToken,
  submittedToken,
  timingSafeEqual,
  isMultipartRequest,
  isSameOriginRequest,
  expectedRequestOrigin,
  suppliedRequestOrigin,
  normalizeOrigin,
};

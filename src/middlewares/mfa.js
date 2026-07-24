const accountStateService = require('../services/auth/accountStateService');
const mfaService = require('../services/auth/mfaService');
const { env } = require('../config/env');

function wantsJson(req) {
  return String(req.originalUrl || req.path || '').startsWith('/api/')
    || req.xhr
    || String(req.headers.accept || '').includes('application/json');
}

function deny(req, res, code, message, status = 403) {
  if (wantsJson(req)) return res.status(status).json({ ok: false, code, message });
  if (req.flash) req.flash('error', message);
  return res.redirect(code === 'mfa_setup_required'
    ? '/auth/mfa/setup'
    : `/login?error=${encodeURIComponent(code)}&next=${encodeURIComponent(req.originalUrl || '/')}`);
}

function verifiedSessionIsFresh(req) {
  const verifiedAt = Date.parse(String(req.session?.mfaVerifiedAt || ''));
  if (!Number.isFinite(verifiedAt)) return false;
  const maxAgeMs = Math.max(5, Number(env.mfaSessionMaxAgeMinutes || 720)) * 60 * 1000;
  return Date.now() - verifiedAt <= maxAgeMs;
}

async function requirePlatformMfa(req, res, next) {
  try {
    if (!env.platformMfaEnabled) return next();
    const sessionUser = req.session?.user;
    if (!sessionUser || !mfaService.isPlatformAdmin(sessionUser.role)) return next();

    const fresh = await accountStateService.currentUser(sessionUser);
    if (!fresh || String(fresh.status || '').toLowerCase() !== 'active') {
      if (req.session) req.session.user = null;
      return deny(req, res, 'account_inactive', 'This administrator account is not active.', 403);
    }

    if (!mfaService.isConfigured(fresh)) {
      return deny(req, res, 'mfa_setup_required', 'Set up authenticator MFA before opening any administrator workspace.');
    }

    if (!verifiedSessionIsFresh(req)) {
      if (req.session) {
        req.session.user = null;
        delete req.session.mfaVerifiedAt;
        delete req.session.mfaChallenge;
      }
      return deny(req, res, 'mfa_required', 'Sign in again and complete multi-factor verification.');
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { requirePlatformMfa, verifiedSessionIsFresh };

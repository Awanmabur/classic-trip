const accountStateService = require('../services/auth/accountStateService');
function wantsJson(req) {
  return String(req.originalUrl || req.path || '').startsWith('/api/') || req.xhr || String(req.headers.accept || '').includes('application/json');
}

function jsonError(res, status, message, code) {
  return res.status(status).json({ ok: false, code, message });
}

async function requireApiAuth(req, res, next) {
  if (req.session?.user) {
    try {
      const current = await accountStateService.refreshSessionUser(req);
      if (current && accountStateService.accountIsActive(current)) return next();
      if (req.session) req.session.user = null;
      return jsonError(res, 403, 'Your account is not active yet.', current?.status === 'pending' ? 'account_pending' : 'account_inactive');
    } catch (error) {
      return next(error);
    }
  }
  return wantsJson(req) ? jsonError(res, 401, 'Authentication is required for this API.', 'auth_required') : res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

function requireApiRole(...roles) {
  return function apiRoleGuard(req, res, next) {
    const { canonicalRole } = require('../config/accessControl');
    const role = canonicalRole(req.session?.user?.role);
    const allowed = roles.map(canonicalRole);
    if (role && allowed.includes(role)) return next();
    return jsonError(res, 403, 'You do not have permission to perform this action.', 'forbidden');
  };
}

function scopedCompanyId(req) {
  const user = req.session?.user || {};
  const { canonicalRole } = require('../config/accessControl');
  if (['super_admin', 'admin'].includes(canonicalRole(user.role))) return req.body?.companyId || req.query?.companyId || user.companyId || '';
  return user.companyId || '';
}

module.exports = { requireApiAuth, requireApiRole, scopedCompanyId };

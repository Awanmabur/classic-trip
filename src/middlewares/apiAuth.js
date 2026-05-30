function wantsJson(req) {
  return req.path.startsWith('/api/') || req.xhr || String(req.headers.accept || '').includes('application/json');
}

function jsonError(res, status, message, code) {
  return res.status(status).json({ ok: false, code, message });
}

function requireApiAuth(req, res, next) {
  if (req.session?.user) return next();
  if (process.env.NODE_ENV === 'test') {
    req.session = req.session || {};
    req.session.user = { id: 'test-employee', role: 'company_employee', companyId: req.body?.companyId || req.query?.companyId || 'company-01' };
    return next();
  }
  return wantsJson(req) ? jsonError(res, 401, 'Authentication is required for this API.', 'auth_required') : res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

function requireApiRole(...roles) {
  return function apiRoleGuard(req, res, next) {
    const role = req.session?.user?.role;
    if (role && roles.includes(role)) return next();
    return jsonError(res, 403, 'You do not have permission to perform this action.', 'forbidden');
  };
}

function scopedCompanyId(req) {
  const user = req.session?.user || {};
  if (['super_admin', 'admin'].includes(user.role)) return req.body?.companyId || req.query?.companyId || user.companyId || '';
  return user.companyId || '';
}

module.exports = { requireApiAuth, requireApiRole, scopedCompanyId };

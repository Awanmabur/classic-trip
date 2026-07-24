const identityRepository = require('../repositories/domain/identityRepository');
const {
  canonicalRole,
  canonicalPermission,
  permissionMatches,
  roleHasPermission,
  normalizePermissions,
} = require('../config/accessControl');

function wantsJson(req) {
  return String(req.originalUrl || req.path || '').startsWith('/api/') || req.xhr || String(req.headers.accept || '').includes('application/json');
}

function deny(req, res, code, message) {
  if (wantsJson(req)) return res.status(403).json({ ok: false, code, message });
  return res.status(403).render('pages/error', { seo: { title: 'Access denied | Classic Trip' }, status: 403, message });
}

async function employeeMembershipFresh(user = {}) {
  const userId = String(user.id || '');
  const companyId = String(user.companyId || '');
  if (!userId || !companyId) return null;
  const fresh = await identityRepository.employees.findOne({ userId, companyId });
  return fresh || null;
}

async function effectivePermissionsFresh(user = {}) {
  if (!['company_employee', 'driver'].includes(canonicalRole(user.role))) return [];
  const membership = await employeeMembershipFresh(user);
  return Array.from(new Set([...normalizePermissions(user.permissions || []), ...normalizePermissions(membership?.permissions || [])]));
}

function requirePermission(...requiredPermissions) {
  const required = requiredPermissions.map(canonicalPermission).filter(Boolean);
  return async function permissionGuard(req, res, next) {
    try {
      const user = req.session?.user || {};
      const role = canonicalRole(user.role);
      if (!role) return deny(req, res, 'auth_required', 'Authentication is required.');
      if (['company_employee', 'driver'].includes(role)) {
        const membership = await employeeMembershipFresh(user);
        if (!membership || membership.status !== 'active') return deny(req, res, 'employee_membership_inactive', 'Your employee membership is not active.');
        const permissions = await effectivePermissionsFresh(user);
        if (required.some((permission) => permissions.some((granted) => permissionMatches(granted, permission)))) return next();
        return deny(req, res, 'permission_denied', 'Your assigned role does not allow this action.');
      }
      if (required.some((permission) => roleHasPermission(role, permission))) return next();
      return deny(req, res, 'permission_denied', 'Your assigned role does not allow this action.');
    } catch (error) { return next(error); }
  };
}

module.exports = { requirePermission, effectivePermissionsFresh, employeeMembershipFresh };

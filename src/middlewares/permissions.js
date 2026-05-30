function hasPermission(user, permission) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (hasPermission(req.session?.user, permission)) return next();
    return res.status(403).json({ error: 'permission_denied', permission });
  };
}

module.exports = { hasPermission, requirePermission };

const { canonicalRole } = require('../config/accessControl');

function requireRole(...roles) {
  const allowed = new Set(roles.map(canonicalRole));
  return function roleGuard(req, res, next) {
    const role = canonicalRole(req.session?.user?.role);
    if (role && allowed.has(role)) return next();
    return res.status(403).render('pages/error', {
      seo: { title: 'Access denied | Classic Trip' },
      status: 403,
      message: 'You do not have permission to open this dashboard.',
    });
  };
}

module.exports = { requireRole };

function requireRole(...roles) {
  return function roleGuard(req, res, next) {
    const role = req.session?.user?.role;
    if (role && roles.includes(role)) return next();
    return res.status(403).render('pages/error', {
      seo: { title: 'Access denied | Classic Trip' },
      status: 403,
      message: 'You do not have permission to open this dashboard.',
    });
  };
}

module.exports = { requireRole };

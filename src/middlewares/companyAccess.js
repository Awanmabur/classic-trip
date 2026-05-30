function requireCompanyAccess(req, res, next) {
  const user = req.session?.user;
  if (!user) return res.redirect('/login');
  if (user.role === 'super_admin' || user.companyId || user.role === 'company_admin' || user.role === 'company_employee') return next();
  return res.status(403).json({ error: 'company_access_required' });
}

module.exports = { requireCompanyAccess };

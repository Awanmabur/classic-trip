// Resolves which company a request should act on. Every company/employee controller used to
// have its own local copy of `req.session?.user?.companyId || req.body.companyId || 'company-01'`
// (30+ call sites). Falling back to a hardcoded company ID whenever the session's
// companyId was unset meant any authenticated company_admin/employee with a missing companyId
// silently got full read/write access to that other company's data instead of an error -
// a cross-tenant data leak, not a convenience default.
function resolveCompanyId(req, { allowOverride = false } = {}) {
  const user = req.session?.user;
  if (allowOverride && ['super_admin', 'admin'].includes(user?.role)) {
    const override = req.body?.companyId || req.query?.companyId;
    if (override) return override;
  }
  const companyId = user?.companyId;
  if (!companyId) {
    const error = new Error('Your account is not linked to a company yet. Please contact support or complete partner onboarding.');
    error.status = 403;
    throw error;
  }
  return companyId;
}

module.exports = { resolveCompanyId };

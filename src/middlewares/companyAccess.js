function wantsJson(req) {
  return String(req.originalUrl || req.path || '').startsWith('/api/') || req.xhr || String(req.headers.accept || '').includes('application/json');
}

function forbidden(req, res, code, message) {
  if (wantsJson(req)) return res.status(403).json({ ok: false, code, message });
  return res.status(403).send(message);
}

function requireCompanyAccess(req, res, next) {
  const user = req.session?.user;
  if (!user) return res.redirect('/login');
  if (user.role === 'super_admin' || user.companyId || user.role === 'company_admin' || user.role === 'company_employee') return next();
  return forbidden(req, res, 'company_access_required', 'Company access is required.');
}

function enforceCompanyScope(req, res, next) {
  const user = req.session?.user || {};
  if (['super_admin', 'admin'].includes(user.role)) return next();
  const requested = req.body?.companyId || req.query?.companyId || req.params?.companyId;
  const isCompanyRole = ['company_admin', 'company_employee', 'partner'].includes(user.role);
  const scoped = user.companyId;
  if (!isCompanyRole) return next();
  if (!scoped) return forbidden(req, res, 'company_scope_missing', 'Your user is not attached to a company.');
  if (requested && String(requested) !== String(scoped)) {
    return forbidden(req, res, 'company_scope_denied', 'You cannot access another company workspace.');
  }
  req.body = req.body || {};
  req.body.companyId = scoped;
  return next();
}

function normalizeService(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function serviceMatches(actual, allowed = []) {
  const normalized = normalizeService(actual);
  const allowedSet = new Set(allowed.map(normalizeService));
  if (allowedSet.has(normalized)) return true;
  if (allowedSet.has('transport') && ['bus', 'train', 'flight', 'cargo', 'car_rental'].includes(normalized)) return true;
  return false;
}

function companyForUser(user = {}) {
  try {
    const store = require('../services/data/persistentStore');
    const companyId = user.companyId;
    return (store.state.companies || []).find((company) => String(company.id || company._id || company.slug) === String(companyId)) || {};
  } catch (error) {
    return {};
  }
}

function requireCompanyOwnService(fieldName = 'serviceType') {
  return (req, res, next) => {
    const user = req.session?.user || {};
    if (['super_admin', 'admin'].includes(user.role)) return next();
    const company = companyForUser(user);
    const companyType = normalizeService(user.companyType || company.companyType || company.type || company.serviceType || '');
    if (!companyType) {
      return forbidden(req, res, 'company_service_missing', 'Your company account has no service type configured.');
    }
    req.body = req.body || {};
    const submitted = normalizeService(req.body[fieldName] || req.body.group || req.body.service || '');
    if (!submitted) {
      req.body[fieldName] = companyType;
      return next();
    }
    if (submitted === companyType) {
      req.body[fieldName] = companyType;
      return next();
    }
    return forbidden(
      req,
      res,
      'company_service_mismatch',
      `This company account can only create or edit ${companyType} service records.`
    );
  };
}

function requireCompanyService(...allowedServices) {
  return (req, res, next) => {
    const user = req.session?.user || {};
    if (['super_admin', 'admin'].includes(user.role)) return next();
    const company = companyForUser(user);
    const companyType = user.companyType || company.companyType || company.type || company.serviceType;
    if (serviceMatches(companyType, allowedServices)) return next();
    return forbidden(
      req,
      res,
      'company_service_denied',
      `This action is only available for ${allowedServices.join(', ')} company accounts.`
    );
  };
}

module.exports = { requireCompanyAccess, enforceCompanyScope, requireCompanyService, requireCompanyOwnService };

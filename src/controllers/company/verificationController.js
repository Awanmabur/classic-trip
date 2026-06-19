const verificationService = require('../../services/onboarding/verificationService');

function actorId(req) {
  return req.session?.user?.id || 'company-system';
}

function companyId(req) {
  return req.session?.user?.companyId || req.body.companyId || 'company-01';
}

async function submitCompany(req, res, next) {
  try {
    await verificationService.submitCompanyChecklist(companyId(req), req.body, actorId(req));
    res.redirect('/company/settings#verification');
  } catch (error) {
    next(error);
  }
}

async function submitDriver(req, res, next) {
  try {
    await verificationService.submitDriverChecklist(req.params.id, req.body, actorId(req));
    res.redirect('/company/staff#drivers');
  } catch (error) {
    next(error);
  }
}

module.exports = { submitCompany, submitDriver };

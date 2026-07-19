const verificationService = require('../../services/onboarding/verificationService');
const { resolveCompanyId } = require('../../utils/companyScope');

function actorId(req) {
  return req.session?.user?.id || 'company-system';
}

function companyId(req) {
  return resolveCompanyId(req);
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

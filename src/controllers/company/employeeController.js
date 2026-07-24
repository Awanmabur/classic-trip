const companyService = require('../../services/company/companyService');
const { resolveCompanyId } = require('../../utils/companyScope');

async function invite(req, res, next) {
  try {
    await companyService.inviteEmployee(resolveCompanyId(req), { ...req.body, invitedBy: req.session?.user?.id || 'company-admin' });
    res.redirect('/company/employees');
  } catch (error) {
    next(error);
  }
}

module.exports = { invite };

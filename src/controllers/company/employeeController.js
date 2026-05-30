const companyService = require('../../services/company/companyService');

async function invite(req, res, next) {
  try {
    await companyService.inviteEmployee(req.session?.user?.companyId || req.body.companyId || 'company-01', req.body);
    res.redirect('/company/employees');
  } catch (error) {
    next(error);
  }
}

module.exports = { invite };

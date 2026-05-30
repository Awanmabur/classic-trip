const companyService = require('../../services/company/companyService');

function companyId(req) {
  return req.session?.user?.companyId || req.body.companyId || 'company-01';
}

async function create(req, res, next) {
  try {
    await companyService.createRoute(companyId(req), req.body);
    res.redirect('/company/routes');
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  try {
    await companyService.updateRoute(companyId(req), req.params.id, req.body);
    res.redirect('/company/routes');
  } catch (error) {
    next(error);
  }
}

async function archive(req, res, next) {
  try {
    await companyService.archiveRoute(companyId(req), req.params.id);
    res.redirect('/company/routes');
  } catch (error) {
    next(error);
  }
}

module.exports = { create, update, archive };

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

async function createStop(req, res, next) {
  try {
    await companyService.createRouteStop(companyId(req), req.params.id || req.body.routeId, req.body, req.session?.user?.id || 'company-admin');
    res.redirect('/company/routes-stops');
  } catch (error) {
    next(error);
  }
}

async function updateStop(req, res, next) {
  try {
    await companyService.updateRouteStop(companyId(req), req.params.stopId, req.body, req.session?.user?.id || 'company-admin');
    res.redirect('/company/routes-stops');
  } catch (error) {
    next(error);
  }
}

async function archiveStop(req, res, next) {
  try {
    await companyService.archiveRouteStop(companyId(req), req.params.stopId, req.session?.user?.id || 'company-admin');
    res.redirect('/company/routes-stops');
  } catch (error) {
    next(error);
  }
}

async function moveStop(req, res, next) {
  try {
    await companyService.moveRouteStop(companyId(req), req.params.stopId, req.body.direction || req.params.direction || 'up', req.session?.user?.id || 'company-admin');
    res.redirect('/company/routes-stops');
  } catch (error) {
    next(error);
  }
}

module.exports = { create, update, archive, createStop, updateStop, archiveStop, moveStop };

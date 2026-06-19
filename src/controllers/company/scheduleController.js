const companyService = require('../../services/company/companyService');

function companyId(req) {
  return req.session?.user?.companyId || req.body.companyId || 'company-01';
}

async function create(req, res, next) {
  try {
    await companyService.createSchedule(companyId(req), req.body);
    res.redirect('/company/schedules');
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  try {
    await companyService.updateSchedule(companyId(req), req.params.id, req.body);
    res.redirect('/company/schedules');
  } catch (error) {
    next(error);
  }
}

async function archive(req, res, next) {
  try {
    await companyService.archiveSchedule(companyId(req), req.params.id);
    res.redirect('/company/schedules');
  } catch (error) {
    next(error);
  }
}

async function publish(req, res, next) {
  try {
    await companyService.publishSchedule(companyId(req), req.params.id);
    res.redirect('/company/schedules');
  } catch (error) {
    next(error);
  }
}

async function updateSeat(req, res, next) {
  try {
    await companyService.updateSeatStatus(companyId(req), req.body);
    res.redirect('/company/seat-maps');
  } catch (error) {
    next(error);
  }
}

async function transition(req, res, next) {
  try {
    await companyService.transitionSchedule(companyId(req), req.params.id, req.body, req.session?.user?.id || 'company-admin');
    res.redirect('/company/schedules-fares');
  } catch (error) {
    next(error);
  }
}

async function complete(req, res, next) {
  try {
    await companyService.completeSchedule(companyId(req), req.params.id, req.body, req.session?.user?.id || 'company-admin');
    res.redirect('/company/passenger-manifests');
  } catch (error) {
    next(error);
  }
}

async function duplicate(req, res, next) {
  try {
    await companyService.duplicateSchedule(companyId(req), req.params.id, req.body, req.session?.user?.id || 'company-admin');
    res.redirect('/company/schedules-fares');
  } catch (error) {
    next(error);
  }
}

module.exports = { create, update, archive, publish, updateSeat, transition, duplicate, complete };

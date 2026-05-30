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

async function updateSeat(req, res, next) {
  try {
    await companyService.updateSeatStatus(companyId(req), req.body);
    res.redirect('/company/rooms');
  } catch (error) {
    next(error);
  }
}

module.exports = { create, update, archive, updateSeat };

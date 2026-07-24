const companyService = require('../../services/company/companyService');
const { resolveCompanyId } = require('../../utils/companyScope');

function companyId(req) {
  return resolveCompanyId(req);
}

function actorId(req) {
  return req.session?.user?.id || 'company-admin';
}

async function createBranch(req, res, next) {
  try {
    await companyService.createBranch(companyId(req), req.body, actorId(req));
    res.redirect('/company/profile#branches');
  } catch (error) {
    next(error);
  }
}

async function createPolicy(req, res, next) {
  try {
    await companyService.createPolicy(companyId(req), req.body, actorId(req));
    res.redirect('/company/profile#policies');
  } catch (error) {
    next(error);
  }
}

async function updateStaffRole(req, res, next) {
  try {
    await companyService.updateEmployeeRole(companyId(req), req.params.id, req.body, actorId(req));
    if (req.flash) req.flash('success', 'Employee role, status, and access were updated.');
    res.redirect('/company/staff#staff');
  } catch (error) {
    next(error);
  }
}

async function updateDriverProfile(req, res, next) {
  try {
    await companyService.updateDriverProfile(companyId(req), req.params.id, req.body, actorId(req));
    res.redirect('/company/staff#drivers');
  } catch (error) {
    next(error);
  }
}

async function activateDriver(req, res, next) {
  try {
    await companyService.activateDriverByCompany(companyId(req), req.params.id, req.body, actorId(req));
    if (req.flash) req.flash('success', 'Driver activated and is now available in departure selectors.');
    res.redirect('/company/staff#drivers');
  } catch (error) {
    next(error);
  }
}

async function assignDriver(req, res, next) {
  try {
    await companyService.assignDriver(companyId(req), req.params.id, req.body, actorId(req));
    res.redirect('/company/schedules#driver-assignments');
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createBranch,
  createPolicy,
  updateStaffRole,
  updateDriverProfile,
  activateDriver,
  assignDriver,
};

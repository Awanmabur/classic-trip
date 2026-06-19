const invitationService = require('../../services/onboarding/invitationService');

function companyId(req) {
  return req.session?.user?.companyId || req.body.companyId || 'company-01';
}

function actorId(req) {
  return req.session?.user?.id || 'company-admin';
}

async function requestDriver(req, res, next) {
  try {
    await invitationService.createInvitation({
      ...req.body,
      type: 'driver',
      companyId: companyId(req),
      role: 'company_employee',
      roleTitle: req.body.roleTitle || 'Driver',
      permissions: req.body.permissions || 'driver_manifest,check_in,trip_status',
    }, actorId(req), 'company_request');
    res.redirect('/company/employees#driver-invites');
  } catch (error) {
    next(error);
  }
}

module.exports = { requestDriver };

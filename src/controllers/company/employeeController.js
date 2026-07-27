const companyService = require('../../services/company/companyService');
const invitationService = require('../../services/onboarding/invitationService');
const { resolveCompanyId } = require('../../utils/companyScope');

function actor(req) { return req.session?.user?.id || 'company-admin'; }

async function companyInvitation(req) {
  const invitation = await invitationService.findById(req.params.id);
  const companyId = resolveCompanyId(req);
  if (!invitation || String(invitation.companyId || '') !== String(companyId) || !['staff', 'driver'].includes(String(invitation.type || '').toLowerCase())) {
    const error = new Error('Company staff invitation not found');
    error.status = 404;
    throw error;
  }
  return invitation;
}

async function invite(req, res, next) {
  try {
    await companyService.inviteEmployee(resolveCompanyId(req), { ...req.body, invitedBy: req.session?.user?.id || 'company-admin' });
    res.redirect('/company/employees');
  } catch (error) {
    next(error);
  }
}

async function resend(req, res, next) {
  try {
    const invitation = await companyInvitation(req);
    await invitationService.resendInvitation(invitation.id, actor(req));
    if (req.flash) req.flash('success', 'The secure invitation was resent with a new expiry date.');
    res.redirect('/company/staff');
  } catch (error) { next(error); }
}

async function revoke(req, res, next) {
  try {
    const invitation = await companyInvitation(req);
    await invitationService.revokeInvitation(invitation.id, actor(req), req.body.reason || 'Revoked by Partner Admin');
    if (req.flash) req.flash('success', 'The invitation was revoked.');
    res.redirect('/company/staff');
  } catch (error) { next(error); }
}

module.exports = { invite, resend, revoke };

const invitationService = require('../../services/onboarding/invitationService');

function actorId(req) {
  return req.session?.user?.id || 'admin-system';
}

async function create(req, res, next) {
  try {
    await invitationService.createInvitation(req.body, actorId(req), 'admin');
    res.redirect('/admin/partners#invitations');
  } catch (error) {
    next(error);
  }
}

async function resend(req, res, next) {
  try {
    await invitationService.resendInvitation(req.params.id, actorId(req));
    res.redirect('/admin/partners#invitations');
  } catch (error) {
    next(error);
  }
}

async function revoke(req, res, next) {
  try {
    await invitationService.revokeInvitation(req.params.id, actorId(req), req.body.reason || '');
    res.redirect('/admin/partners#invitations');
  } catch (error) {
    next(error);
  }
}

async function approve(req, res, next) {
  try {
    await invitationService.approveRequestedInvitation(req.params.id, actorId(req));
    res.redirect('/admin/partners#invitations');
  } catch (error) {
    next(error);
  }
}

module.exports = { create, resend, revoke, approve };

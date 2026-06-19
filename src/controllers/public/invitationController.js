const invitationService = require('../../services/onboarding/invitationService');
const authService = require('../../services/auth/authService');

function show(req, res, next) {
  try {
    const invitation = invitationService.findByToken(req.params.token);
    if (!invitation || invitation.status !== 'sent') {
      const error = new Error('Invitation link is invalid, expired, or no longer active');
      error.status = 400;
      throw error;
    }
    res.render('pages/invite-accept', {
      seo: { title: 'Accept invitation | Classic Trip' },
      invitation,
    });
  } catch (error) {
    next(error);
  }
}

async function accept(req, res, next) {
  try {
    if (req.body.password !== req.body.confirmPassword) {
      const error = new Error('Passwords do not match');
      error.status = 422;
      throw error;
    }
    const { user } = await invitationService.acceptInvitation(req.params.token, req.body);
    req.session.user = { ...user, passwordHash: undefined };
    res.redirect(authService.redirectForRole(user.role));
  } catch (error) {
    next(error);
  }
}


async function reject(req, res, next) {
  try {
    await invitationService.rejectInvitation(req.params.token, req.body);
    res.redirect('/login?invite=rejected');
  } catch (error) {
    next(error);
  }
}

module.exports = { show, accept, reject };

const invitationService = require('../../services/onboarding/invitationService');
const authService = require('../../services/auth/authService');
const accountStateService = require('../../services/auth/accountStateService');

function safeFormData(body = {}) {
  const clean = { ...body };
  delete clean.password;
  delete clean.confirmPassword;
  delete clean._csrf;
  return clean;
}

async function renderInvite(res, invitation, inviteToken, options = {}) {
  return res.status(options.status || 200).render('pages/invite-accept', {
    seo: { title: 'Accept invitation | Classic Trip' },
    invitation,
    inviteToken,
    formError: options.formError || '',
    formData: options.formData || {},
  });
}

async function show(req, res, next) {
  try {
    const invitation = await invitationService.findByToken(req.params.token);
    if (!invitation || invitation.status !== 'sent') {
      const error = new Error('Invitation link is invalid, expired, or no longer active');
      error.status = 400;
      throw error;
    }
    return renderInvite(res, invitation, req.params.token);
  } catch (error) { return next(error); }
}

async function accept(req, res, next) {
  try {
    if (req.body.password !== req.body.confirmPassword) {
      const error = new Error('Passwords do not match');
      error.status = 422;
      throw error;
    }
    const { user } = await invitationService.acceptInvitation(req.params.token, req.body);
    await new Promise((resolve, reject) => req.session.regenerate((error) => (error ? reject(error) : resolve())));
    const context = await accountStateService.accessContext(user);
    accountStateService.applyToSession(req, user, context);
    if (user.phone && !user.phoneVerifiedAt && ['company_admin', 'driver', 'promoter'].includes(user.role)) {
      if (req.flash) req.flash('success', 'Account created. Enter the code sent to your phone to continue verification.');
      return res.redirect('/account/phone-verification');
    }
    return res.redirect(authService.redirectAfterAuthentication(authService.sanitizeUser(user)));
  } catch (error) {
    if (error.status === 422 || error.code === 'invitation_profile_incomplete') {
      try {
        const invitation = await invitationService.findByToken(req.params.token);
        if (invitation?.status === 'sent') return renderInvite(res, invitation, req.params.token, { status: 422, formError: error.message, formData: safeFormData(req.body) });
      } catch (_) { /* fall through to the central error handler */ }
    }
    return next(error);
  }
}

async function reject(req, res, next) {
  try {
    await invitationService.rejectInvitation(req.params.token, req.body);
    return res.redirect('/login?invite=rejected');
  } catch (error) { return next(error); }
}

module.exports = { show, accept, reject };

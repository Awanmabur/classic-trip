const accountStateService = require('../../services/auth/accountStateService');
const phoneVerificationService = require('../../services/auth/phoneVerificationService');
const authService = require('../../services/auth/authService');

async function sessionUser(req) {
  return accountStateService.currentUser(req.session?.user || {});
}

async function show(req, res, next) {
  try {
    const user = await sessionUser(req);
    if (!user) return res.redirect('/login');
    return res.render('pages/auth/phone-verification', {
      seo: { title: 'Verify phone number | Classic Trip' },
      user,
    });
  } catch (error) { return next(error); }
}

async function requestCode(req, res, next) {
  try {
    const user = await sessionUser(req);
    if (!user) return res.redirect('/login');
    const result = await phoneVerificationService.requestCode(user.id);
    if (req.flash) req.flash('success', result.alreadyVerified ? 'Your phone number is already verified.' : 'A six-digit verification code was sent to your phone.');
    return res.redirect('/account/phone-verification');
  } catch (error) {
    if (['phone_code_rate_limited'].includes(error.code) || error.status === 422) {
      if (req.flash) req.flash('error', error.message);
      return res.redirect('/account/phone-verification');
    }
    return next(error);
  }
}

async function verify(req, res, next) {
  try {
    const user = await sessionUser(req);
    if (!user) return res.redirect('/login');
    const verified = await phoneVerificationService.verifyCode(user.id, req.body.code);
    const context = await accountStateService.accessContext(verified);
    accountStateService.applyToSession(req, verified, context);
    if (req.flash) req.flash('success', 'Your phone number is verified.');
    return res.redirect(authService.redirectAfterAuthentication(authService.sanitizeUser(verified)));
  } catch (error) {
    if (String(error.code || '').startsWith('phone_code_') || error.status === 422 || error.status === 429) {
      if (req.flash) req.flash('error', error.message);
      return res.redirect('/account/phone-verification');
    }
    return next(error);
  }
}

module.exports = { show, requestCode, verify };

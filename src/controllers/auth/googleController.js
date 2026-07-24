const authService = require('../../services/auth/authService');
const securityService = require('../../services/security/securityService');

function setGoogleIntent(req, res, next) {
  req.session.googleIntent = {
    role: authService.normalizeRole(req.query.role || 'customer'),
    companyName: req.query.companyName || req.query.company || '',
    companyType: req.query.companyType || req.query.businessType || '',
    country: req.query.country || '',
    city: req.query.city || '',
    phone: req.query.phone || '',
    signupSource: 'google_oauth',
  };
  next();
}

async function afterGoogleLogin(req, res, next) {
  try {
    const user = req.user;
    const intent = req.session?.googleIntent || null;
    if (!user || user.status !== 'active') {
      req.logout?.(() => {});
      if (req.session) delete req.session.user;
      return res.redirect('/login?pending=approval');
    }
    await new Promise((resolve, reject) => req.session.regenerate((error) => (error ? reject(error) : resolve())));
    req.session.user = user;
    if (intent) req.session.googleIntentCompleted = true;
    await securityService.recordLoginAttempt({ user, identity: user.email || user.phone, result: 'success', req });
    return res.redirect(authService.redirectAfterAuthentication(user));
  } catch (error) {
    return next(error);
  }
}

function disabled(req, res) {
  res.status(501).render('pages/error', {
    seo: { title: 'Google OAuth is not configured | Classic Trip' },
    status: 501,
    message: 'Google login is wired in the code. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable it.',
  });
}

module.exports = { setGoogleIntent, afterGoogleLogin, disabled };

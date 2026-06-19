const authService = require('../../services/auth/authService');

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

function afterGoogleLogin(req, res) {
  req.session.user = req.user;
  delete req.session.googleIntent;
  delete req.session.googleIntentRole;
  res.redirect(authService.redirectForRole(req.user.role));
}

function disabled(req, res) {
  res.status(501).render('pages/error', {
    seo: { title: 'Google OAuth is not configured | Classic Trip' },
    status: 501,
    message: 'Google login is wired in the code. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable it.',
  });
}

module.exports = { setGoogleIntent, afterGoogleLogin, disabled };

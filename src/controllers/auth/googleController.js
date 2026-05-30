const authService = require('../../services/auth/authService');

function setGoogleIntent(req, res, next) {
  req.session.googleIntentRole = req.query.role || 'customer';
  next();
}

function afterGoogleLogin(req, res) {
  req.session.user = req.user;
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

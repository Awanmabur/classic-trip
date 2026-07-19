const { redirectForRole } = require('../utils/dashboardRedirect');

function attachUser(req, res, next) {
  const user = req.session?.user || null;
  res.locals.currentUser = user;
  res.locals.dashboardUrl = user ? redirectForRole(user.role) : '/login';
  next();
}

function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

function redirectIfAuthenticated(req, res, next) {
  if (!req.session?.user) return next();
  return res.redirect(redirectForRole(req.session.user.role));
}

module.exports = { attachUser, requireAuth, redirectIfAuthenticated };

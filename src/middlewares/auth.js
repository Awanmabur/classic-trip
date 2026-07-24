const { redirectForRole } = require('../utils/dashboardRedirect');
const accountStateService = require('../services/auth/accountStateService');

function attachUser(req, res, next) {
  const user = req.session?.user || null;
  res.locals.currentUser = user;
  res.locals.dashboardUrl = user ? redirectForRole(user.role) : '/login';
  next();
}

function sessionAccountIsActive(user = {}) {
  return accountStateService.accountIsActive(user);
}

async function requireAuth(req, res, next) {
  try {
    const user = req.session?.user;
    if (!user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    const current = await accountStateService.refreshSessionUser(req);
    if (!current || !sessionAccountIsActive(current)) {
      if (req.session) req.session.user = null;
      const state = current?.status || 'inactive';
      return res.redirect(`/login?error=${encodeURIComponent(state === 'pending' ? 'pending' : 'inactive')}`);
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

async function redirectIfAuthenticated(req, res, next) {
  try {
    const current = await accountStateService.refreshSessionUser(req);
    if (!current || !sessionAccountIsActive(current)) return next();
    return res.redirect(redirectForRole(current.role));
  } catch (error) {
    return next(error);
  }
}

module.exports = { attachUser, requireAuth, redirectIfAuthenticated, sessionAccountIsActive };

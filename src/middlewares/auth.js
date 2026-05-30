function attachUser(req, res, next) {
  res.locals.currentUser = req.session?.user || null;
  next();
}

function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

function redirectIfAuthenticated(req, res, next) {
  if (!req.session?.user) return next();
  return res.redirect('/account');
}

module.exports = { attachUser, requireAuth, redirectIfAuthenticated };

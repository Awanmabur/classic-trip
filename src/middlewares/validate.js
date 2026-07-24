const { validationResult } = require('express-validator');

function validateRequest(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  const details = errors.array();
  if (req.originalUrl.startsWith('/api/') || String(req.headers.accept || '').includes('application/json')) {
    return res.status(422).json({ error: 'validation_failed', details });
  }
  const authPath = String(req.path || '');
  if (authPath === '/partner/onboarding') {
    const message = details.map((item) => item.msg).join(', ') || 'Please check the partner onboarding form and try again.';
    if (req.flash) req.flash('error', message);
    return res.redirect('/register?role=partner#partner');
  }
  if (authPath.startsWith('/invite/')) {
    const message = details.map((item) => item.msg).join(', ') || 'Please check the invitation form and try again.';
    if (req.flash) req.flash('error', message);
    return res.redirect(authPath.replace(/\/reject$/, ''));
  }
  if (authPath === '/account/phone-verification/verify') {
    const message = details.map((item) => item.msg).join(', ') || 'Enter the six-digit verification code.';
    if (req.flash) req.flash('error', message);
    return res.redirect('/account/phone-verification');
  }
  if (['/login', '/register', '/forgot-password', '/reset-password'].includes(authPath)) {
    const message = details.map((item) => item.msg).join(', ') || 'Please check the form and try again.';
    if (req.flash) req.flash('error', message);
    if (authPath === '/register' && ['partner', 'company', 'company_admin'].includes(String(req.body?.role || '').toLowerCase())) {
      return res.redirect('/register?role=partner#partner');
    }
    const panel = authPath === '/register' ? 'signup' : authPath === '/forgot-password' ? 'forgot' : 'login';
    return res.redirect(`/login?error=validation#${panel}`);
  }
  return res.status(422).render('pages/error', {
    seo: { title: 'Validation failed | Classic Trip' },
    status: 422,
    message: details.map((item) => item.msg).join(', ') || 'Please check the form and try again.',
  });
}

module.exports = { validateRequest };

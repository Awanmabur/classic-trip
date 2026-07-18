const authService = require('../../services/auth/authService');
const securityService = require('../../services/security/securityService');

function welcomeName(user = {}) {
  return String(user.fullName || user.name || user.email || 'there').trim().split(/\s+/)[0] || 'there';
}

// Only allow same-origin relative paths; reject absolute or protocol-relative URLs.
function safeRedirectUrl(url, fallback) {
  if (!url) return fallback;
  const str = String(url).trim();
  if (str.startsWith('/') && !str.startsWith('//')) return str;
  return fallback;
}

function showLogin(req, res) {
  res.render('pages/auth/login', {
    seo: { title: 'Login or signup | Classic Trip' },
    next: req.query.next || '',
  });
}

function showResetPassword(req, res) {
  res.render('pages/auth/reset-password', {
    seo: { title: 'Reset password | Classic Trip' },
    token: req.params.token || '',
  });
}

async function login(req, res, next) {
  try {
    const user = await authService.verifyLogin(req.body.identity || req.body.email, req.body.password);
    if (!user) {
      await securityService.recordLoginAttempt({
        identity: req.body.identity || req.body.email,
        result: 'failure',
        reason: 'invalid_credentials',
        req,
      });
      return res.redirect('/login?error=invalid');
    }
    // Regenerate the session to prevent session fixation attacks.
    await new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
    req.session.user = user;
    await securityService.recordLoginAttempt({
      user,
      identity: req.body.identity || req.body.email,
      result: 'success',
      req,
    });
    if (req.flash) req.flash('success', `Welcome back, ${welcomeName(user)}. Your dashboard is ready.`);
    const nextUrl = safeRedirectUrl(req.body.next || req.query.next, authService.redirectForRole(user.role));
    return res.redirect(nextUrl);
  } catch (error) {
    return next(error);
  }
}

async function register(req, res, next) {
  try {
    const user = await authService.registerUser({
      fullName: req.body.fullName || req.body.name || [req.body.firstName, req.body.lastName].filter(Boolean).join(' '),
      email: req.body.email,
      phone: req.body.phone,
      password: req.body.password,
      role: ({ partner: 'company_admin', employee: 'company_employee' }[req.body.role] || req.body.role || req.body.accountType || 'customer'),
      company: req.body.company || req.body.companyName || req.body.businessName,
      companyType: req.body.companyType || req.body.businessType,
      country: req.body.country,
      city: req.body.city,
      roleTitle: req.body.roleTitle,
    });
    // Regenerate the session to prevent session fixation attacks (mirrors login()).
    await new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
    req.session.user = user;
    if (req.flash) req.flash('success', `Welcome, ${welcomeName(user)}. Your account is ready.`);
    return res.redirect(authService.redirectForRole(user.role));
  } catch (error) {
    return next(error);
  }
}

async function logout(req, res, next) {
  try {
    await securityService.closeDeviceSession(req);
    req.session.destroy(() => res.redirect('/'));
  } catch (error) {
    next(error);
  }
}

async function forgotPassword(req, res, next) {
  try {
    await authService.requestPasswordReset(req.body.identity);
    return res.redirect('/login#forgot');
  } catch (error) {
    return next(error);
  }
}

async function resetPassword(req, res, next) {
  try {
    if (req.body.password !== req.body.confirmPassword) {
      const error = new Error('Passwords do not match');
      error.status = 422;
      throw error;
    }
    await authService.resetPassword(req.body.token || req.params.token, req.body.password);
    return res.redirect('/login');
  } catch (error) {
    return next(error);
  }
}

async function verifyEmail(req, res, next) {
  try {
    await authService.verifyEmail(req.params.token);
    if (req.flash) req.flash('success', 'Email verified. You can now log in.');
    return res.redirect('/login');
  } catch (error) {
    return res.render('pages/auth/verify-email', {
      seo: { title: 'Verify email | Classic Trip' },
      error: error.message,
      token: req.params.token,
    });
  }
}

async function resendVerification(req, res, next) {
  try {
    const userId = req.session?.user?.id;
    if (userId) await authService.resendVerificationEmail(userId);
    if (req.flash) req.flash('success', 'Verification email sent. Check your inbox.');
    const back = req.get('Referer') || '/account';
    return res.redirect(back);
  } catch (error) {
    return next(error);
  }
}

module.exports = { showLogin, showResetPassword, login, register, forgotPassword, resetPassword, logout, verifyEmail, resendVerification };

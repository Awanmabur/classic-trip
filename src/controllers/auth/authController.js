const authService = require('../../services/auth/authService');

function showLogin(req, res) {
  res.render('pages/auth/login', {
    seo: { title: 'Login or signup | Classic Trip' },
    next: req.query.next || '',
  });
}

async function login(req, res, next) {
  try {
    const user = await authService.verifyLogin(req.body.identity || req.body.email, req.body.password);
    if (!user) return res.redirect('/login?error=invalid');
    req.session.user = user;
    const nextUrl = req.body.next || req.query.next || authService.redirectForRole(user.role);
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
    });
    req.session.user = user;
    return res.redirect(authService.redirectForRole(user.role));
  } catch (error) {
    return next(error);
  }
}

function logout(req, res) {
  req.session.destroy(() => res.redirect('/'));
}

module.exports = { showLogin, login, register, logout };

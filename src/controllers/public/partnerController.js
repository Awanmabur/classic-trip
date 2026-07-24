const authService = require('../../services/auth/authService');

function redirectToPartnerForm(res, errorCode = '') {
  const suffix = errorCode ? `?error=${encodeURIComponent(errorCode)}` : '?role=partner';
  return res.redirect(`/register${suffix}#partner`);
}

async function createOnboarding(req, res, next) {
  try {
    if (req.session?.user) {
      if (req.session.user.role === 'company_admin') return res.redirect('/company/profile?onboarding=1');
      const error = new Error('Sign out before registering a separate partner company. Existing company staff must join through a signed invitation.');
      error.status = 409;
      error.code = 'authenticated_account_conflict';
      throw error;
    }
    const user = await authService.registerUser({
      fullName: req.body.contactName,
      email: req.body.email,
      phone: req.body.phone,
      password: req.body.password,
      role: 'company_admin',
      company: req.body.name,
      companyName: req.body.name,
      legalName: req.body.legalName,
      companyType: req.body.companyType,
      country: req.body.country,
      city: req.body.city,
      operatingCurrency: req.body.operatingCurrency,
      registrationNumber: req.body.registrationNumber,
      taxNumber: req.body.taxNumber,
      headOfficeAddress: req.body.headOfficeAddress,
      website: req.body.website,
      description: req.body.description,
      termsAccepted: req.body.termsAccepted,
      signupSource: 'partner_onboarding',
    });
    await new Promise((resolve, reject) => req.session.regenerate((error) => (error ? reject(error) : resolve())));
    req.session.user = authService.sanitizeUser(user);
    if (req.flash) req.flash('success', 'Partner account created. Complete company verification before publishing services or receiving payouts. No registration payment is required.');
    return res.redirect('/company/profile?onboarding=1');
  } catch (error) {
    if (['account_exists', 'registration_conflict', 'company_registration_conflict', 'company_identifier_unavailable', 'authenticated_account_conflict'].includes(error.code)) {
      if (req.flash) req.flash('error', error.message);
      return redirectToPartnerForm(res, error.code);
    }
    return next(error);
  }
}

function commissionInfo(req, res) {
  return res.render('pages/partner-commission', {
    seo: {
      title: 'Partner commission | Classic Trip',
      description: 'Classic Trip partners register directly and pay only the configured percentage commission on completed bookings.',
    },
  });
}

module.exports = { createOnboarding, commissionInfo };

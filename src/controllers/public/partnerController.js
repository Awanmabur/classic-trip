const { currencyForCountry } = require('../../config/countryMarkets');
const authService = require('../../services/auth/authService');
const logger = require('../../config/logger');


function partnerDraft(body = {}) {
  const allowed = ['partnerCategory','companyType','name','contactName','email','phone','country','city','legalName','registrationNumber','taxNumber','headOfficeAddress','website','description','agencyLicenceNumber','iataTidsNumber','agencySpecialities','preferredOperatingAreas','fleetSize','vehicleTypes','vehicleType','vehicleMake','vehicleModel','vehicleYear','vehicleColor','hasOwnVehicle'];
  return allowed.reduce((draft, key) => {
    if (typeof body[key] !== 'undefined') draft[key] = String(body[key] || '').slice(0, 1000);
    return draft;
  }, {});
}

async function establishPartnerSession(req, user) {
  if (!req.session) return false;
  try {
    await new Promise((resolve, reject) => req.session.regenerate((error) => (error ? reject(error) : resolve())));
    req.session.user = authService.sanitizeUser(user);
    return true;
  } catch (error) {
    // The partner account is already committed. A transient session-store error
    // must not tell the applicant that registration failed or create duplicates.
    logger.error('Partner signup succeeded but session regeneration failed', { userId: user?.id, error: error.message });
    return false;
  }
}

function partnerSafeMessage(error) {
  if (error?.publicMessage) return error.publicMessage;
  if (Number(error?.status) >= 400 && Number(error?.status) < 500) return error.message;
  if (/database|mongo|connection|timeout|pool/i.test(String(error?.message || ''))) return 'Classic Trip could not finish partner setup because the database was temporarily busy. Your details were not partially saved; please try once more.';
  return 'Classic Trip could not complete the partner application. Please try again. If it continues, contact support and mention Partner signup.';
}

function redirectToPartnerForm(res, errorCode = '') {
  const suffix = errorCode ? `?error=${encodeURIComponent(errorCode)}` : '?role=partner';
  return res.redirect(`/login${suffix}#partner`);
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
      partnerCategory: req.body.partnerCategory,
      country: req.body.country,
      city: req.body.city,
      operatingCurrency: currencyForCountry(req.body.country),
      registrationNumber: req.body.registrationNumber,
      taxNumber: req.body.taxNumber,
      headOfficeAddress: req.body.headOfficeAddress,
      website: req.body.website,
      description: req.body.description,
      agencyLicenceNumber: req.body.agencyLicenceNumber,
      iataTidsNumber: req.body.iataTidsNumber,
      agencySpecialities: req.body.agencySpecialities,
      nationalIdNumber: req.body.nationalIdNumber,
      driverLicenceNumber: req.body.driverLicenceNumber,
      driverLicenceExpiry: req.body.driverLicenceExpiry,
      vehicleRegistrationNumber: req.body.vehicleRegistrationNumber,
      vehicleType: req.body.vehicleType,
      vehicleMake: req.body.vehicleMake,
      vehicleModel: req.body.vehicleModel,
      vehicleYear: req.body.vehicleYear,
      vehicleColor: req.body.vehicleColor,
      inspectionExpiry: req.body.inspectionExpiry,
      insuranceExpiry: req.body.insuranceExpiry,
      fleetSize: req.body.fleetSize,
      vehicleTypes: req.body.vehicleTypes,
      preferredOperatingAreas: req.body.preferredOperatingAreas,
      hasOwnVehicle: req.body.hasOwnVehicle,
      termsAccepted: req.body.termsAccepted,
      signupSource: 'partner_onboarding',
    });
    const signedIn = await establishPartnerSession(req, user);
    if (req.flash) req.flash('success', signedIn
      ? 'Partner account created. Complete company verification before publishing services or receiving payouts. No registration payment is required.'
      : 'Partner account created successfully. Please sign in to continue company verification.');
    return res.redirect(signedIn ? '/company/profile?onboarding=1' : '/login?created=partner#login');
  } catch (error) {
    if (req.session) req.session.partnerFormDraft = partnerDraft(req.body);
    logger.error('Partner onboarding failed', {
      code: error.code || 'partner_signup_failed',
      status: error.status || 500,
      partnerCategory: req.body?.partnerCategory || '',
      companyType: req.body?.companyType || '',
      country: req.body?.country || '',
      error: error.message,
      stack: Number(error.status || 500) >= 500 ? error.stack : undefined,
    });
    if (req.flash) req.flash('error', partnerSafeMessage(error));
    return redirectToPartnerForm(res, error.code || 'partner_signup_failed');
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

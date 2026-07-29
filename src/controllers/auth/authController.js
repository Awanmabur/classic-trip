const authService = require('../../services/auth/authService');
const securityService = require('../../services/security/securityService');
const accountStateService = require('../../services/auth/accountStateService');
const identityRepository = require('../../repositories/domain/identityRepository');
const mfaService = require('../../services/auth/mfaService');
const { verifiedSessionIsFresh } = require('../../middlewares/mfa');
const QRCode = require('qrcode');
const { env } = require('../../config/env');
const { isDriverAccountOperational } = require('../../services/company/driverEligibilityService');
const logger = require('../../config/logger');

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


function registrationRedirect(user = {}) {
  if (user.role === 'company_admin') return '/company/profile?onboarding=1';
  if (user.role === 'promoter') return '/promoter/profile?onboarding=1';
  return authService.redirectForRole(user.role);
}

function securityRequestSnapshot(req = {}) {
  return {
    id: req.id || '',
    ip: req.ip || '',
    headers: { ...(req.headers || {}) },
    sessionID: req.sessionID || '',
    session: { user: req.session?.user || null, id: req.session?.id || '' },
  };
}

function saveSession(req) {
  return new Promise((resolve, reject) => req.session.save((error) => (error ? reject(error) : resolve())));
}

function authQueryMessage(query = {}) {
  const code = String(query.error || '').toLowerCase();
  const messages = {
    invalid: 'The email, phone number, or password is incorrect. Please check your details and try again.',
    invalid_credentials: 'The email, phone number, or password is incorrect. Please check your details and try again.',
    locked: 'Too many unsuccessful login attempts. Please wait 15 minutes, then try again or reset your password.',
    account_locked: 'Too many unsuccessful login attempts. Please wait 15 minutes, then try again or reset your password.',
    pending: 'This account is awaiting approval. You can review its onboarding status after approval.',
    inactive: 'This account is not active. Contact Classic Trip support if you believe this is a mistake.',
    mfa_required: 'Sign in again and complete multi-factor verification.',
    validation: 'Please correct the highlighted account details and try again.',
    rate_limited: 'Too many attempts were submitted. Please wait a few minutes before trying again.',
  };
  if (messages[code]) return { type: 'error', text: messages[code] };
  if (String(query.pending || '').toLowerCase() === 'approval') return { type: 'info', text: 'Your account was created and is awaiting activation.' };
  return null;
}

async function showLogin(req, res, next) {
  try {
    res.set('Cache-Control', 'no-store, max-age=0');
    const queryMessage = authQueryMessage(req.query || {});
    const flashMessages = Array.isArray(res.locals.flashMessages) ? [...res.locals.flashMessages] : [];
    if (queryMessage && !flashMessages.length) flashMessages.push(queryMessage);
    return res.render('pages/auth/login', {
      seo: { title: 'Login, signup or partner onboarding | Classic Trip' },
      next: req.query.next || '',
      partnerForm: { ...req.query },
      flashMessages,
    });
  } catch (error) {
    return next(error);
  }
}


async function showOnboardingStatus(req, res, next) {
  try {
    const user = await accountStateService.currentUser(req.session?.user || {});
    if (!user) return res.redirect('/login');
    const context = await accountStateService.accessContext(user);
    if (user.role === 'company_admin') return res.redirect('/company/profile?onboarding=1');
    if (user.role === 'promoter') return res.redirect('/promoter/profile?onboarding=1');
    if (env.platformMfaEnabled && mfaService.isPlatformAdmin(user.role) && !mfaService.isConfigured(user)) return res.redirect('/auth/mfa/setup');
    if (user.role === 'company_employee' && context.membership?.status === 'active') return res.redirect('/employee/dashboard');
    if (user.role === 'driver' && context.membership?.status === 'active' && isDriverAccountOperational(user)) return res.redirect('/driver/dashboard');
    const review = context.membership?.id
      ? await identityRepository.verificationReviews.findOne({ targetType: 'driver', targetId: context.membership.id })
      : null;
    return res.render('pages/auth/onboarding-status', {
      seo: { title: 'Account onboarding status | Classic Trip' },
      user,
      company: context.company,
      membership: context.membership,
      review,
    });
  } catch (error) {
    return next(error);
  }
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
      if (req.flash) req.flash('error', 'The email, phone number, or password is incorrect. Please check your details and try again.');
      return res.redirect('/login?error=invalid');
    }
    const nextUrl = safeRedirectUrl(req.body.next || req.query.next, authService.redirectAfterAuthentication(user));
    if (env.platformMfaEnabled && mfaService.isPlatformAdmin(user.role) && user.mfaConfigured) {
      await new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
      req.session.mfaChallenge = {
        userId: user.id,
        identity: user.email || user.phone || req.body.identity,
        next: nextUrl,
        attempts: 0,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      };
      return res.redirect('/auth/mfa/challenge');
    }
    // Regenerate the session to prevent session fixation attacks.
    await new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
    req.session.user = user;
    if (req.flash) req.flash('success', `Welcome back, ${welcomeName(user)}. Your dashboard is ready.`);
    // Persist the authenticated session before redirecting. Device/audit writes are
    // still recorded, but no longer hold the user on the login page for several
    // extra Atlas round trips.
    await saveSession(req);
    const auditReq = securityRequestSnapshot(req);
    setImmediate(() => {
      securityService.recordLoginAttempt({
        user,
        identity: req.body.identity || req.body.email,
        result: 'success',
        req: auditReq,
      }).catch((auditError) => logger.error('Successful login audit could not be recorded', { error: auditError.message, userId: user.id }));
    });
    return res.redirect(nextUrl);
  } catch (error) {
    if (error.code === 'account_locked') {
      if (req.flash) req.flash('error', 'Too many unsuccessful login attempts. Please wait 15 minutes, then try again or reset your password.');
      return res.redirect('/login?error=locked');
    }
    if (error.code === 'account_pending') {
      if (req.flash) req.flash('warning', 'This account is awaiting approval.');
      return res.redirect('/login?error=pending');
    }
    return next(error);
  }
}

async function register(req, res, next) {
  try {
    const requestedRole = String(req.body.role || req.body.accountType || 'customer').toLowerCase().trim();
    if (['partner', 'company', 'company_admin'].includes(requestedRole)) {
      if (req.flash) req.flash('info', 'Complete the partner company form on this same account page. No registration payment is required.');
      return res.redirect('/register?role=partner#partner');
    }
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
      operatingCurrency: req.body.operatingCurrency,
      roleTitle: req.body.roleTitle,
    });
    if (user.status !== 'active') {
      if (req.flash) req.flash('success', 'Your invitation-based account is awaiting activation.');
      return res.redirect('/login?pending=approval');
    }
    // Regenerate the session to prevent session fixation attacks (mirrors login()).
    await new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
    req.session.user = user;
    if (req.flash) {
      const message = user.role === 'company_admin'
        ? `Welcome, ${welcomeName(user)}. Complete company verification before publishing or receiving payouts.`
        : user.role === 'promoter'
          ? `Welcome, ${welcomeName(user)}. Complete promoter verification before withdrawals or offline sales.`
          : `Welcome, ${welcomeName(user)}. Your account is ready.`;
      req.flash('success', message);
    }
    return res.redirect(registrationRedirect(user));
  } catch (error) {
    if (error.code === 'invitation_required') {
      if (req.flash) req.flash('error', error.message);
      return res.redirect('/login#signup');
    }
    if (['account_exists', 'registration_conflict', 'company_registration_conflict', 'company_identifier_unavailable'].includes(error.code)) {
      if (req.flash) req.flash('error', error.message);
      return res.redirect(`/login?error=${encodeURIComponent(error.code)}#signup`);
    }
    return next(error);
  }
}


async function showMfaSetup(req, res, next) {
  try {
    const user = await accountStateService.currentUser(req.session?.user || {});
    if (!user) return res.redirect('/login');
    if (!env.platformMfaEnabled) {
      if (req.session) {
        delete req.session.mfaVerifiedAt;
        delete req.session.mfaChallenge;
      }
      if (req.flash) req.flash('success', 'Administrator MFA is temporarily disabled by platform configuration.');
      return res.redirect(authService.redirectForRole(user.role));
    }
    if (!mfaService.isPlatformAdmin(user.role)) return res.status(403).render('pages/error', { seo: { title: 'Access denied | Classic Trip' }, status: 403, message: 'MFA setup is reserved for platform administrators.' });
    if (mfaService.isConfigured(user)) {
      if (verifiedSessionIsFresh(req)) return res.redirect(authService.redirectForRole(user.role));
      // A configured administrator may not reuse the MFA setup endpoint as a
      // shortcut around the login challenge. Require a fresh full sign-in.
      if (req.session) {
        req.session.user = null;
        delete req.session.mfaVerifiedAt;
        delete req.session.mfaChallenge;
      }
      return res.redirect('/login?error=mfa_required');
    }
    const setup = await mfaService.beginSetup(user.id);
    const qrDataUrl = await QRCode.toDataURL(setup.otpauthUrl, { errorCorrectionLevel: 'M', margin: 1, width: 260 });
    return res.render('pages/auth/mfa-setup', {
      seo: { title: 'Set up multi-factor authentication | Classic Trip' },
      setup,
      qrDataUrl,
      recoveryCodes: null,
    });
  } catch (error) {
    return next(error);
  }
}

async function confirmMfaSetup(req, res, next) {
  try {
    const user = await accountStateService.currentUser(req.session?.user || {});
    if (!user) return res.redirect('/login');
    if (!env.platformMfaEnabled) {
      if (req.session) {
        delete req.session.mfaVerifiedAt;
        delete req.session.mfaChallenge;
      }
      if (req.flash) req.flash('success', 'Administrator MFA is temporarily disabled by platform configuration.');
      return res.redirect(authService.redirectForRole(user.role));
    }
    const result = await mfaService.confirmSetup(user.id, req.body.code);
    const cleanUser = authService.sanitizeUser(result.user);
    req.session.user = cleanUser;
    req.session.mfaVerifiedAt = new Date().toISOString();
    return res.render('pages/auth/mfa-setup', {
      seo: { title: 'MFA enabled | Classic Trip' },
      setup: null,
      qrDataUrl: null,
      recoveryCodes: result.recoveryCodes,
    });
  } catch (error) {
    if (error.code === 'invalid_mfa_code' || error.code === 'mfa_setup_expired') {
      if (req.flash) req.flash('error', error.message);
      return res.redirect('/auth/mfa/setup');
    }
    return next(error);
  }
}

function showMfaChallenge(req, res) {
  if (!env.platformMfaEnabled) {
    if (req.session) delete req.session.mfaChallenge;
    return res.redirect('/login?mfa=disabled');
  }
  const challenge = req.session?.mfaChallenge;
  if (!challenge || !challenge.expiresAt || new Date(challenge.expiresAt) <= new Date()) {
    if (req.session) delete req.session.mfaChallenge;
    return res.redirect('/login?error=mfa_expired');
  }
  return res.render('pages/auth/mfa-challenge', {
    seo: { title: 'Administrator verification | Classic Trip' },
    identity: challenge.identity,
  });
}

async function verifyMfaChallenge(req, res, next) {
  const challenge = req.session?.mfaChallenge;
  try {
    if (!env.platformMfaEnabled) {
      if (req.session) delete req.session.mfaChallenge;
      return res.redirect('/login?mfa=disabled');
    }
    if (!challenge || !challenge.expiresAt || new Date(challenge.expiresAt) <= new Date()) {
      throw Object.assign(new Error('The MFA login challenge expired. Sign in again.'), { status: 401, code: 'mfa_expired' });
    }
    challenge.attempts = Number(challenge.attempts || 0) + 1;
    if (challenge.attempts > 5) {
      const identity = challenge.identity;
      delete req.session.mfaChallenge;
      await securityService.recordLoginAttempt({ identity, result: 'failure', reason: 'mfa_attempt_limit', req });
      return res.redirect('/login?error=locked');
    }
    const user = await mfaService.verifyChallenge(challenge.userId, req.body.code);
    const destination = safeRedirectUrl(challenge.next, authService.redirectForRole(user.role));
    await new Promise((resolve, reject) => req.session.regenerate((error) => (error ? reject(error) : resolve())));
    req.session.user = user;
    req.session.mfaVerifiedAt = new Date().toISOString();
    await securityService.recordLoginAttempt({ user, identity: challenge.identity || user.email || user.phone, result: 'success', req });
    if (req.flash) req.flash('success', `Welcome back, ${welcomeName(user)}. Multi-factor verification passed.`);
    return res.redirect(destination);
  } catch (error) {
    if (error.code === 'invalid_mfa_code') {
      if (req.flash) req.flash('error', error.message);
      return res.redirect('/auth/mfa/challenge');
    }
    if (error.code === 'mfa_expired') return res.redirect('/login?error=mfa_expired');
    return next(error);
  }
}

async function logout(req, res, next) {
  try {
    await securityService.closeDeviceSession(req);
    return req.session.regenerate((error) => {
      if (error) return next(error);
      if (req.flash) req.flash('success', 'You have been signed out securely.');
      return res.redirect('/');
    });
  } catch (error) {
    return next(error);
  }
}

async function forgotPassword(req, res, next) {
  try {
    await authService.requestPasswordReset(req.body.identity);
    if (req.flash) req.flash('success', 'Password reset instructions were sent when the account details matched.');
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
    if (req.flash) req.flash('success', 'Password reset completed. Sign in with your new password.');
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

module.exports = { showLogin, showOnboardingStatus, showResetPassword, showMfaSetup, confirmMfaSetup, showMfaChallenge, verifyMfaChallenge, login, register, forgotPassword, resetPassword, logout, verifyEmail, resendVerification };

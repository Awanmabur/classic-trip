const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const identityRepository = require('../../repositories/domain/identityRepository');
const { env } = require('../../config/env');
const { mongoose } = require('../../config/db');
const logger = require('../../config/logger');
const generateReferralCode = require('../../utils/generateReferralCode');
const companyService = require('../company/companyService');
const walletService = require('../wallet/walletService');
const securityService = require('../security/securityService');
const verificationService = require('../onboarding/verificationService');
const { nextId } = require('../data/idService');
const financeRepository = require('../../repositories/domain/financeRepository');
const { validatePassword } = require('./passwordPolicy');
const { cleanEmail, cleanPhone, phoneVariants, identityLookup } = require('./identityContact');
const { duplicateKeyFields } = require('../../utils/mongoDuplicate');

const DUMMY_PASSWORD_HASH = '$2a$12$MW0.CBMwAw3YYPsCTztILu3yznr0RfMePYZWCM9H6XpBBE7.SWFY6';
const { isDriverAccountOperational } = require('../company/driverEligibilityService');

function cleanText(value, max = 1000) { return String(value || '').replace(/<[^>]*>/g, '').trim().replace(/\s+/g, ' ').slice(0, max); }
function normalizeIdentity(value) { return cleanEmail(value); }
function normalizeRole(role) {
  const aliases = { partner: 'company_admin', company: 'company_admin', company_admin: 'company_admin', employee: 'company_employee', staff: 'company_employee', company_employee: 'company_employee', driver: 'driver', promoter: 'promoter', customer: 'customer' };
  return aliases[cleanText(role, 50).toLowerCase()] || 'customer';
}
function scrubUser(user) {
  if (!user) return user;
  const clean = { ...user, mfaConfigured: Boolean(user.twoFactorEnabled && user.mfa?.secretEncrypted) };
  delete clean.passwordHash;
  delete clean.emailVerifyToken;
  delete clean.passwordReset;
  delete clean.phoneVerification;
  delete clean.mfa;
  delete clean.mfaSetup;
  return clean;
}
async function persist(entity, row, filter) { await identityRepository[entity].save(row, filter); return row; }

async function rollbackNewAccount(user, cause) {
  if (!user?.id) return;
  try {
    const companies = await identityRepository.companies.list({ ownerId: user.id });
    const companyIds = companies.map((company) => company.id).filter(Boolean);
    const reviewFilters = [{ targetType: 'promoter', targetId: user.id }];
    if (companyIds.length) reviewFilters.push({ targetType: 'company', targetId: { $in: companyIds } });
    const walletFilters = [{ ownerType: 'promoter', ownerId: user.id }];
    if (companyIds.length) walletFilters.push({ ownerType: 'company', ownerId: { $in: companyIds } });
    await Promise.all([
      identityRepository.verificationReviews.deleteMany({ $or: reviewFilters }),
      financeRepository.wallets.deleteMany({ $or: walletFilters }),
      identityRepository.employees.deleteMany({ userId: user.id }),
      identityRepository.companies.deleteMany({ ownerId: user.id }),
      identityRepository.users.deleteOne({ id: user.id }),
    ]);
    logger.error('Incomplete registration was compensated', { userId: user.id, reason: cause?.message || 'unknown' });
  } catch (rollbackError) {
    logger.error('Registration compensation failed', {
      userId: user.id,
      originalError: cause?.message || 'unknown',
      rollbackError: rollbackError.message,
    });
  }
}

async function findUserByIdentity(identity) {
  const lookup = identityLookup(identity);
  if (lookup.email) return identityRepository.users.findOne({ email: lookup.email });
  if (lookup.phones.length) return identityRepository.users.findOne({ phone: { $in: lookup.phones } });
  return null;
}

async function findRegistrationConflict({ email, phone } = {}) {
  const normalizedEmail = cleanEmail(email);
  const normalizedPhone = cleanPhone(phone);
  const emailUser = normalizedEmail ? await identityRepository.users.findOne({ email: normalizedEmail }) : null;
  const phones = phoneVariants(normalizedPhone);
  const phoneUser = phones.length ? await identityRepository.users.findOne({ phone: { $in: phones } }) : null;
  if (!emailUser && !phoneUser) return null;
  const matchedFields = [];
  if (emailUser) matchedFields.push('email');
  if (phoneUser) matchedFields.push('phone');
  return {
    matchedFields,
    user: emailUser || phoneUser,
    emailUser,
    phoneUser,
    email: normalizedEmail,
    phone: normalizedPhone,
  };
}

function accountExistsError(conflict = {}) {
  const fields = conflict.matchedFields || [];
  const label = fields.length === 2 ? 'email address and phone number' : fields[0] === 'email' ? 'email address' : 'phone number';
  const error = new Error(`That ${label} already belongs to an account. Sign in instead, recover the existing account, or use a different ${fields.length === 2 ? 'email and phone number' : fields[0] === 'email' ? 'email address' : 'phone number'}.`);
  error.status = 409;
  error.code = 'account_exists';
  error.conflictFields = fields;
  return error;
}

async function uniqueReferralCode(seed, userId) {
  const root = cleanText(generateReferralCode(seed || `PROMOTER-${Date.now()}`), 80).toUpperCase().replace(/[^A-Z0-9-]+/g, '-') || `PROMOTER-${Date.now()}`;
  let code = root; let index = 1;
  while (await identityRepository.users.findOne({ referralCode: code, id: { $ne: userId || '' } })) { index += 1; code = `${root}-${index}`; }
  return code;
}

async function recordAudit(action, actorId, entityType, entityId, status = 'pending') {
  const audit = { id: await nextId('audit'), actorId, action, target: entityId, entityType, entityId, status, createdAt: new Date().toISOString() };
  await identityRepository.auditLogs.save(audit, { id: audit.id }); return audit;
}

async function provisionPromoter(user, payload = {}) {
  user.role = 'promoter'; user.referralCode = user.referralCode || await uniqueReferralCode(user.fullName || user.email, user.id); user.verificationStatus = user.verificationStatus || 'pending'; user.onboardingStatus = user.onboardingStatus || 'promoter_verification';
  user.promoterProfile = { ...(user.promoterProfile || {}), defaultChannel: cleanText(payload.defaultChannel || 'social', 80), bio: cleanText(payload.bio || '', 500), signupSource: cleanText(payload.signupSource || 'auth_register', 80) };
  user.payoutAccount = user.payoutAccount || { method: cleanText(payload.payoutMethod || 'Mobile Money', 80), account: cleanText(payload.payoutAccount || user.phone || '', 120) };
  user.updatedAt = new Date().toISOString();
  const { defaultCurrency } = await require('../platform/platformConfigService').getPlatformConfig();
  const wallet = await walletService.getOrCreateWallet('promoter', user.id, defaultCurrency);
  await identityRepository.users.save(user, { id: user.id });
  await verificationService.getReview('promoter', user.id);
  await recordAudit('auth.promoter_registered', user.id, 'user', user.id, 'pending_verification');
  return { user, wallet };
}

function requestedCompanyName(payload = {}, user = {}) { return cleanText(payload.company || payload.companyName || payload.businessName || payload.organization || payload.name, 180) || `${user.fullName || 'Classic Trip'} company`; }
async function findOrCreateSignupCompany(user, payload = {}, ownerId = null) {
  // Public signup always creates a new organization. Joining an existing
  // organization is allowed only through the signed invitation workflow.
  const company = await companyService.createCompany({
    ownerId,
    name: requestedCompanyName(payload, user),
    companyType: cleanText(payload.companyType || payload.businessType || payload.type, 80),
    country: cleanText(payload.country, 80),
    city: cleanText(payload.city || payload.headOfficeCity || payload.locationCity || '', 120),
    email: normalizeIdentity(payload.email || user.email),
    phone: cleanText(payload.phone || user.phone, 60),
    legalName: cleanText(payload.legalName || requestedCompanyName(payload, user), 200),
    registrationNumber: cleanText(payload.registrationNumber, 120),
    taxNumber: cleanText(payload.taxNumber, 120),
    headOfficeAddress: cleanText(payload.headOfficeAddress || payload.address, 400),
    website: cleanText(payload.website, 300),
    description: cleanText(payload.description || `Auth signup application for ${requestedCompanyName(payload, user)}`, 1000),
    operatingCurrency: payload.operatingCurrency,
    termsAccepted: payload.termsAccepted,
    acceptedBy: user.id,
    allowIncompleteProfile: true,
  });
  company.onboardingSource = cleanText(payload.signupSource || 'auth_register', 80);
  company.settings = {
    ...(company.settings || {}),
    canPublish: false,
    instantConfirmation: false,
    onboardingStep: 'verification',
  };
  await identityRepository.companies.save(company, { id: company.id });
  return company;
}

async function provisionCompanyAdmin(user, payload = {}) {
  const company = await findOrCreateSignupCompany(user, payload, user.id); const wallet = await walletService.getOrCreateWallet('company', company.id, company.operatingCurrency);
  Object.assign(company, { ownerId: company.ownerId || user.id, walletId: wallet.id, updatedAt: new Date().toISOString() });
  Object.assign(user, {
    role: 'company_admin',
    companyId: company.id,
    status: 'active',
    isVerified: false,
    verificationStatus: 'pending',
    onboardingStatus: 'company_verification',
    updatedAt: new Date().toISOString(),
  });
  await Promise.all([identityRepository.companies.save(company, { id: company.id }), identityRepository.users.save(user, { id: user.id })]);
  await verificationService.getReview('company', company.id);
  await recordAudit('auth.company_admin_registered', user.id, 'company', company.id, 'pending_verification');
  return { user, company, wallet };
}

async function provisionCompanyEmployee() {
  const error = new Error('Employee and driver accounts must be created through a secure company invitation.');
  error.status = 403;
  error.code = 'invitation_required';
  throw error;
}

async function provisionRoleArtifacts(user, payload = {}) {
  const role = normalizeRole(payload.role || user.role);
  if (role === 'promoter') return provisionPromoter(user, payload);
  if (role === 'company_admin') return provisionCompanyAdmin(user, payload);
  if (role === 'company_employee') return provisionCompanyEmployee(user, payload);
  user.role = 'customer'; user.updatedAt = new Date().toISOString(); await identityRepository.users.save(user, { id: user.id }); return { user };
}

const LOGIN_LOCKOUT_THRESHOLD = 5; const LOGIN_LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
async function verifyLogin(identity, password) {
  const failed = securityService.recentFailedLoginCountLive ? await securityService.recentFailedLoginCountLive(identity, LOGIN_LOCKOUT_WINDOW_MS) : securityService.recentFailedLoginCount(identity, LOGIN_LOCKOUT_WINDOW_MS);
  if (failed >= LOGIN_LOCKOUT_THRESHOLD) { const error = new Error('Too many failed login attempts for this account. Please try again in 15 minutes.'); error.status = 429; error.code = 'account_locked'; throw error; }
  const user = await findUserByIdentity(identity);
  if (!user) {
    await bcrypt.compare(String(password || ''), DUMMY_PASSWORD_HASH);
    return null;
  }
  if (['suspended', 'blocked'].includes(user.status)) {
    await bcrypt.compare(String(password || ''), user.passwordHash || DUMMY_PASSWORD_HASH);
    return null;
  }
  if (user.status === 'pending') { const error = new Error('This account is awaiting approval.'); error.status = 403; error.code = 'account_pending'; throw error; }
  if (user.status !== 'active') {
    await bcrypt.compare(String(password || ''), user.passwordHash || DUMMY_PASSWORD_HASH);
    return null;
  }
  const valid = await bcrypt.compare(String(password || ''), user.passwordHash || DUMMY_PASSWORD_HASH);
  return user.passwordHash && valid ? scrubUser(user) : null;
}

async function sendEmailVerification(user) {
  if (!user.email) return null;
  const token = crypto.randomBytes(24).toString('hex');
  user.emailVerifyToken = securityService.sha256(token);
  user.emailVerifyTokenExpiresAt = new Date(Date.now() + 86400000).toISOString();
  await identityRepository.users.save(user, { id: user.id });
  try {
    await require('../notification/notificationService').queueNotification({
      userId: user.id,
      channels: ['email'],
      title: 'Verify your Classic Trip email',
      message: `Hello ${(user.fullName || '').split(' ')[0] || 'there'},

Please verify your email address:

${env.appUrl}/verify-email/${token}

This link expires in 24 hours.`,
      recipient: { email: user.email, name: user.fullName },
      referenceType: 'email_verification',
      referenceId: user.id,
      persistedMessage: 'A secure email verification link was sent. The token is not stored in notification history.',
      persistedMeta: { expiresAt: user.emailVerifyTokenExpiresAt, tokenStored: false },
    });
  } catch (error) {
    // A temporary notification outage must not make an otherwise valid signup
    // appear to have failed. The saved token can be resent from the account.
    logger.error('Email verification notification could not be queued', { userId: user.id, error: error.message });
  }
  return process.env.NODE_ENV === 'test' ? token : null;
}

async function insertRegistrationUser(user) {
  try {
    const created = await identityRepository.users.insert(user);
    Object.assign(user, created);
    return user;
  } catch (error) {
    if (Number(error?.code) !== 11000) throw error;
    const fields = duplicateKeyFields(error);
    if (fields.includes('email')) throw accountExistsError({ matchedFields: ['email'] });
    if (fields.includes('phone')) throw accountExistsError({ matchedFields: ['phone'] });
    throw error;
  }
}

async function registerUser(payload) {
  const localPassword = validatePassword(payload.password);
  const email = cleanEmail(payload.email); const phone = cleanPhone(payload.phone);
  if (!email && !phone) { const error = new Error('Email or phone is required'); error.status = 422; throw error; }
  const conflict = await findRegistrationConflict({ email, phone });
  if (conflict) {
    logger.warn('Registration identity already exists', {
      conflictFields: conflict.matchedFields,
      matchedUserId: conflict.user?.id,
      matchedRole: conflict.user?.role,
      signupRole: normalizeRole(payload.role || 'customer'),
      database: mongoose.connection?.name || 'not_connected',
    });
    throw accountExistsError(conflict);
  }
  const role = normalizeRole(payload.role || 'customer');
  if (role === 'company_employee' || role === 'driver') {
    const error = new Error('Employee and driver accounts must be created through a secure company invitation.');
    error.status = 403;
    error.code = 'invitation_required';
    throw error;
  }
  const passwordHash = await bcrypt.hash(localPassword, 12);
  const user = { fullName: cleanText(payload.fullName || payload.name || 'Classic Trip User', 160), email, phone, role, passwordHash, status: ['customer', 'promoter', 'company_admin'].includes(role) ? 'active' : 'pending', isVerified: false, referralCode: role === 'promoter' ? await uniqueReferralCode(payload.fullName || email) : undefined, authProviders: { local: { enabled: Boolean(passwordHash) }, google: { enabled: false } }, createdAt: new Date().toISOString() };
  await insertRegistrationUser(user);
  try {
    await provisionRoleArtifacts(user, { ...payload, role, signupSource: 'auth_register' });
    if (user.email) await sendEmailVerification(user);
  } catch (error) {
    await rollbackNewAccount(user, error);
    if (Number(error?.code) === 11000) {
      const duplicateFields = duplicateKeyFields(error);
      logger.error('Partner registration provisioning hit a non-identity duplicate key', {
        duplicateFields,
        signupRole: role,
        database: mongoose.connection?.name || 'not_connected',
      });
      const conflict = new Error('The account identity is available, but partner setup encountered conflicting organization data. Please retry. If it continues, an administrator should inspect the company and counter collections.');
      conflict.status = 409;
      conflict.code = 'registration_conflict';
      conflict.duplicateFields = duplicateFields;
      throw conflict;
    }
    throw error;
  }
  if (user.phone) {
    try { await require('./phoneVerificationService').requestCode(user.id); }
    catch (error) { logger.error('Initial phone verification could not be queued', { userId: user.id, error: error.message }); }
  }
  return scrubUser(user);
}

async function verifyEmail(token) {
  const tokenHash = securityService.sha256(token); const user = await identityRepository.users.findOne({ emailVerifyToken: tokenHash });
  if (!user || !user.emailVerifyTokenExpiresAt || new Date(user.emailVerifyTokenExpiresAt) < new Date()) { const error = new Error('Email verification link is invalid or expired'); error.status = 400; throw error; }
  Object.assign(user, { emailVerifiedAt: new Date().toISOString(), isVerified: true, emailVerifyToken: undefined, emailVerifyTokenExpiresAt: undefined, updatedAt: new Date().toISOString() });
  await identityRepository.users.save(user, { id: user.id });
  try { await verificationService.markEmailVerifiedForUser(user.id, user.id); }
  catch (error) { logger.error('Email verification checklist could not be updated', { userId: user.id, error: error.message }); }
  return scrubUser(user);
}
async function resendVerificationEmail(userId) { const user = await identityRepository.users.findOne({ id: userId }); if (!user?.email) return { ok: false }; if (user.emailVerifiedAt) return { ok: true, alreadyVerified: true }; await sendEmailVerification(user); return { ok: true }; }

async function findOrCreateGoogleUser(profile, intent = {}) {
  const email = normalizeIdentity(profile.emails?.[0]?.value); if (!email) { const error = new Error('Google account email is required'); error.status = 422; throw error; }
  const fullName = cleanText(profile.displayName || [profile.name?.givenName, profile.name?.familyName].filter(Boolean).join(' ') || 'Google User', 160);
  let user = await findUserByIdentity(email);
  if (user) {
    if (['suspended', 'blocked'].includes(user.status)) { const error = new Error('This account is not allowed to sign in'); error.status = 403; throw error; }
    user.authProviders = { ...(user.authProviders || {}), google: { enabled: true, googleId: profile.id } }; Object.assign(user, { googleId: profile.id, emailVerifiedAt: user.emailVerifiedAt || new Date().toISOString(), lastLoginAt: new Date().toISOString() }); await identityRepository.users.save(user, { id: user.id }); return scrubUser(user);
  }
  const role = normalizeRole(intent.role || 'customer');
  if (role === 'company_employee' || role === 'driver') {
    const error = new Error('Employee and driver accounts must be created through a secure company invitation.');
    error.status = 403;
    error.code = 'invitation_required';
    throw error;
  }
  user = { fullName, email, phone: cleanPhone(intent.phone), role, googleId: profile.id, status: ['customer', 'promoter', 'company_admin'].includes(role) ? 'active' : 'pending', isVerified: ['customer', 'promoter'].includes(role), authProviders: { local: { enabled: false }, google: { enabled: true, googleId: profile.id } }, emailVerifiedAt: new Date().toISOString(), createdAt: new Date().toISOString() };
  Object.assign(user, await identityRepository.users.insert(user));
  try {
    await provisionRoleArtifacts(user, { ...intent, role, fullName, email, signupSource: 'google_oauth' });
    if (user.phone) {
      try { await require('./phoneVerificationService').requestCode(user.id); }
      catch (error) { logger.error('Initial Google phone verification could not be queued', { userId: user.id, error: error.message }); }
    }
    return scrubUser(user);
  } catch (error) {
    await rollbackNewAccount(user, error);
    throw error;
  }
}

async function requestPasswordReset(identity) {
  const user = await findUserByIdentity(identity);
  if (!user) return { ok: true, sent: false };
  const token = crypto.randomBytes(24).toString('hex');
  user.passwordReset = {
    tokenHash: securityService.sha256(token),
    tokenPreview: `${token.slice(0, 6)}...${token.slice(-4)}`,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    requestedAt: new Date().toISOString(),
  };
  await identityRepository.users.save(user, { id: user.id });
  await require('../notification/notificationService').queueNotification({
    userId: user.id,
    channels: ['email', 'sms'],
    title: 'Classic Trip password reset',
    message: `Use this link to reset your password: ${env.appUrl}/reset-password/${token}`,
    recipient: { email: user.email, phone: user.phone, name: user.fullName },
    referenceType: 'password_reset',
    referenceId: user.id,
    persistedMessage: 'A secure password-reset link was sent. The token is not stored in notification history.',
    persistedMeta: { expiresAt: user.passwordReset.expiresAt, tokenPreview: user.passwordReset.tokenPreview, tokenStored: false },
  });
  return { ok: true, sent: true, ...(process.env.NODE_ENV === 'test' ? { testToken: token } : {}) };
}

async function resetPassword(token, password) {
  const validatedPassword = validatePassword(password);
  const tokenHash = securityService.sha256(token); const user = await identityRepository.users.findOne({ 'passwordReset.tokenHash': tokenHash });
  if (!user || !user.passwordReset?.expiresAt || new Date(user.passwordReset.expiresAt) < new Date()) { const error = new Error('Password reset link is invalid or expired'); error.status = 400; throw error; }
  user.passwordHash = await bcrypt.hash(validatedPassword, 12);
  user.authProviders = { ...(user.authProviders || {}), local: { enabled: true } };
  user.passwordReset = null;
  user.passwordChangedAt = new Date().toISOString();
  user.authVersion = Number(user.authVersion || 0) + 1;
  user.updatedAt = new Date().toISOString();
  await identityRepository.users.save(user, { id: user.id });
  await identityRepository.deviceSessions.updateMany(
    { userId: user.id, status: 'active' },
    { $set: { status: 'revoked', revokedAt: new Date(), updatedAt: new Date() } }
  );
  await recordAudit('auth.password_reset_completed', user.id, 'user', user.id, 'success');
  return scrubUser(user);
}

const { redirectForRole } = require('../../utils/dashboardRedirect');
function redirectAfterAuthentication(user = {}) {
  if (user.role === 'company_admin' && String(user.verificationStatus || '').toLowerCase() !== 'verified') return '/company/profile?onboarding=1';
  if (user.role === 'promoter' && String(user.verificationStatus || '').toLowerCase() !== 'verified') return '/promoter/profile?onboarding=1';
  if (user.role === 'driver' && !isDriverAccountOperational(user)) return '/onboarding/status';
  if (user.role === 'company_employee' && String(user.verificationStatus || '').toLowerCase() !== 'verified') return '/onboarding/status';
  const mfaService = require('./mfaService');
  if (env.platformMfaEnabled && mfaService.isPlatformAdmin(user.role) && !user.mfaConfigured) return '/auth/mfa/setup';
  return redirectForRole(user.role);
}
module.exports = { verifyLogin, registerUser, findOrCreateGoogleUser, requestPasswordReset, resetPassword, redirectForRole, redirectAfterAuthentication, normalizeRole, verifyEmail, resendVerificationEmail, findUserByIdentity, findRegistrationConflict, sanitizeUser: scrubUser };

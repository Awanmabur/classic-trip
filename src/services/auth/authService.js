const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const store = require('../data/persistentStore');
const repositories = require('../../repositories');
const { env } = require('../../config/env');
const generateReferralCode = require('../../utils/generateReferralCode');
const companyService = require('../company/companyService');
const walletService = require('../wallet/walletService');
const securityService = require('../security/securityService');

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

function normalizeRole(role) {
  const key = cleanText(role).toLowerCase();
  const aliases = {
    partner: 'company_admin',
    company: 'company_admin',
    company_admin: 'company_admin',
    employee: 'company_employee',
    staff: 'company_employee',
    company_employee: 'company_employee',
    promoter: 'promoter',
    customer: 'customer',
  };
  return aliases[key] || 'customer';
}

function scrubUser(user) {
  if (!user) return user;
  return { ...user, passwordHash: undefined };
}

async function persist(entity, row) {
  await repositories.repositoryFor(entity).upsert(row);
  return row;
}

function nextId(prefix, rows = []) {
  let index = rows.length + 1;
  let id = `${prefix}-${index}`;
  while (rows.some((row) => row.id === id)) {
    index += 1;
    id = `${prefix}-${index}`;
  }
  return id;
}

function uniqueReferralCode(seed, userId) {
  const root = cleanText(generateReferralCode(seed || `PROMOTER-${Date.now()}`))
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, '-');
  let code = root || `PROMOTER-${Date.now()}`;
  let index = 1;
  while (store.state.users.some((item) => item.id !== userId && String(item.referralCode || '').toUpperCase() === code)) {
    index += 1;
    code = `${root}-${index}`;
  }
  return code;
}

async function recordAudit(action, actorId, entityType, entityId, status = 'pending') {
  const audit = {
    id: nextId('audit', store.state.auditLogs),
    actorId,
    action,
    target: entityId,
    entityType,
    entityId,
    status,
    createdAt: new Date().toISOString(),
  };
  store.state.auditLogs.unshift(audit);
  await persist('auditLogs', audit);
  return audit;
}

async function provisionPromoter(user, payload = {}) {
  user.role = 'promoter';
  user.referralCode = user.referralCode || uniqueReferralCode(user.fullName || user.email, user.id);
  user.verificationStatus = user.verificationStatus || 'pending';
  user.promoterProfile = {
    ...(user.promoterProfile || {}),
    defaultChannel: cleanText(payload.defaultChannel || 'social'),
    bio: cleanText(payload.bio || ''),
    signupSource: cleanText(payload.signupSource || 'auth_register'),
  };
  user.payoutAccount = user.payoutAccount || {
    method: cleanText(payload.payoutMethod || 'Mobile Money'),
    account: cleanText(payload.payoutAccount || user.phone || ''),
  };
  user.updatedAt = new Date().toISOString();
  const wallet = walletService.getOrCreateWallet('promoter', user.id, cleanText(payload.currency || 'UGX'));
  await persist('users', user);
  await persist('wallets', wallet);
  await recordAudit('auth.promoter_registered', user.id, 'user', user.id, 'pending_verification');
  return { user, wallet };
}

function requestedCompanyName(payload = {}, user = {}) {
  return cleanText(payload.company || payload.companyName || payload.businessName || payload.organization || payload.name)
    || `${user.fullName || 'Classic Trip'} company`;
}

async function findOrCreateSignupCompany(user, payload = {}, ownerId = null) {
  const requestedCompany = cleanText(payload.companyId || payload.companySlug);
  let company = requestedCompany ? store.findCompany(requestedCompany) : null;
  const existingCompany = Boolean(company);
  if (!company) {
    company = await companyService.createCompany({
      ownerId,
      name: requestedCompanyName(payload, user),
      companyType: cleanText(payload.companyType || payload.businessType || payload.type || 'partner'),
      country: cleanText(payload.country || 'Uganda'),
      city: cleanText(payload.city || ''),
      email: cleanText(payload.email || user.email),
      phone: cleanText(payload.phone || user.phone),
      description: cleanText(payload.description || `Auth signup application for ${requestedCompanyName(payload, user)}`),
    });
  }
  company.onboardingSource = cleanText(payload.signupSource || 'auth_register');
  if (!existingCompany || company.verificationStatus !== 'verified') {
    company.settings = {
      ...(company.settings || {}),
      canPublish: false,
      instantConfirmation: false,
      onboardingStep: 'verification',
    };
  }
  return company;
}

async function provisionCompanyAdmin(user, payload = {}) {
  const company = await findOrCreateSignupCompany(user, payload, user.id);
  const wallet = walletService.getOrCreateWallet('company', company.id, cleanText(payload.currency || 'UGX'));
  company.ownerId = company.ownerId || user.id;
  company.walletId = wallet.id;
  company.updatedAt = new Date().toISOString();
  user.role = 'company_admin';
  user.companyId = company.id;
  user.status = 'pending';
  user.verificationStatus = 'pending';
  user.updatedAt = new Date().toISOString();
  await persist('companies', company);
  await persist('users', user);
  await persist('wallets', wallet);
  await recordAudit('auth.company_admin_registered', user.id, 'company', company.id, 'pending_verification');
  return { user, company, wallet };
}

async function provisionCompanyEmployee(user, payload = {}) {
  const company = await findOrCreateSignupCompany(user, payload, null);
  user.role = 'company_employee';
  user.companyId = company.id;
  user.status = 'pending';
  user.verificationStatus = 'pending';
  user.updatedAt = new Date().toISOString();
  let employee = store.state.companyEmployees.find((item) => item.companyId === company.id && item.userId === user.id);
  if (!employee) {
    employee = {
      id: nextId('company-employee', store.state.companyEmployees),
      companyId: company.id,
      userId: user.id,
      roleTitle: cleanText(payload.roleTitle || 'Employee applicant'),
      branch: cleanText(payload.branch || company.city || 'Main branch'),
      permissions: ['view_bookings'],
      status: 'requested',
      invitedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    store.state.companyEmployees.push(employee);
  }
  await persist('companies', company);
  await persist('users', user);
  await persist('companyEmployees', employee);
  await recordAudit('auth.company_employee_requested', user.id, 'company_employee', employee.id, 'pending_approval');
  return { user, company, employee };
}

async function provisionRoleArtifacts(user, payload = {}) {
  const role = normalizeRole(payload.role || user.role);
  if (role === 'promoter') return provisionPromoter(user, payload);
  if (role === 'company_admin') return provisionCompanyAdmin(user, payload);
  if (role === 'company_employee') return provisionCompanyEmployee(user, payload);
  user.role = 'customer';
  user.updatedAt = new Date().toISOString();
  await persist('users', user);
  return { user };
}

async function verifyLogin(identity, password) {
  const user = store.findUserByIdentity(identity);
  if (!user || user.status === 'suspended' || user.status === 'blocked') return null;
  if (password === env.demoPassword) return { ...user, passwordHash: undefined };
  if (user.passwordHash && await bcrypt.compare(password, user.passwordHash)) return { ...user, passwordHash: undefined };
  return null;
}

async function registerUser(payload) {
  const role = normalizeRole(payload.role || 'customer');
  const passwordHash = payload.password ? await bcrypt.hash(payload.password, 10) : undefined;
  const user = store.upsertUser({
    fullName: payload.fullName || payload.name || 'Classic Trip User',
    email: payload.email,
    phone: payload.phone,
    role,
    passwordHash,
    status: role === 'customer' || role === 'promoter' ? 'active' : 'pending',
    isVerified: false,
    referralCode: role === 'promoter' ? uniqueReferralCode(payload.fullName || payload.email, payload.id) : undefined,
    authProviders: { local: { enabled: Boolean(passwordHash) }, google: { enabled: false } },
  });
  await provisionRoleArtifacts(user, { ...payload, role, signupSource: 'auth_register' });
  return scrubUser(user);
}

async function findOrCreateGoogleUser(profile, intent = {}) {
  const email = cleanText(profile.emails?.[0]?.value).toLowerCase();
  if (!email) {
    const error = new Error('Google account email is required');
    error.status = 422;
    throw error;
  }
  const fullName = cleanText(profile.displayName || [profile.name?.givenName, profile.name?.familyName].filter(Boolean).join(' ')) || 'Google User';
  let user = store.findUserByIdentity(email);
  if (user) {
    if (user.status === 'suspended' || user.status === 'blocked') {
      const error = new Error('This account is not allowed to sign in');
      error.status = 403;
      throw error;
    }
    user.authProviders = user.authProviders || {};
    user.authProviders.google = { enabled: true, googleId: profile.id };
    user.googleId = profile.id;
    user.emailVerifiedAt = user.emailVerifiedAt || new Date().toISOString();
    user.lastLoginAt = new Date().toISOString();
    await persist('users', user);
    return scrubUser(user);
  }
  const role = normalizeRole(intent.role || 'customer');
  user = store.upsertUser({
    fullName,
    email,
    phone: cleanText(intent.phone || ''),
    role,
    googleId: profile.id,
    status: role === 'customer' || role === 'promoter' ? 'active' : 'pending',
    isVerified: role === 'customer' || role === 'promoter',
    authProviders: { local: { enabled: false }, google: { enabled: true, googleId: profile.id } },
    emailVerifiedAt: new Date().toISOString(),
  });
  await provisionRoleArtifacts(user, {
    ...intent,
    role,
    fullName,
    email,
    phone: intent.phone || '',
    signupSource: 'google_oauth',
  });
  return scrubUser(user);
}

async function requestPasswordReset(identity) {
  const user = store.findUserByIdentity(identity);
  if (!user) return { ok: true, sent: false };
  const token = crypto.randomBytes(24).toString('hex');
  user.passwordReset = {
    tokenHash: securityService.sha256(token),
    tokenPreview: `${token.slice(0, 6)}...${token.slice(-4)}`,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    requestedAt: new Date().toISOString(),
  };
  const notificationService = require('../notification/notificationService');
  await notificationService.queueNotification({
    userId: user.id,
    channels: ['email', 'sms'],
    title: 'Classic Trip password reset',
    message: `Use this link to reset your password: ${env.appUrl}/reset-password/${token}`,
    recipient: { email: user.email, phone: user.phone, name: user.fullName },
    referenceType: 'password_reset',
    referenceId: user.id,
  });
  return { ok: true, sent: true, token };
}

async function resetPassword(token, password) {
  const tokenHash = securityService.sha256(token);
  const user = store.state.users.find((item) => item.passwordReset?.tokenHash === tokenHash);
  if (!user || !user.passwordReset?.expiresAt || new Date(user.passwordReset.expiresAt) < new Date()) {
    const error = new Error('Password reset link is invalid or expired');
    error.status = 400;
    throw error;
  }
  user.passwordHash = await bcrypt.hash(password, 10);
  user.authProviders = {
    ...(user.authProviders || {}),
    local: { enabled: true },
  };
  user.passwordReset = null;
  user.updatedAt = new Date().toISOString();
  return { ...user, passwordHash: undefined };
}

function redirectForRole(role) {
  const map = {
    super_admin: '/admin',
    company_admin: '/company/dashboard',
    company_employee: '/employee/dashboard',
    promoter: '/promoter/dashboard',
    customer: '/account',
  };
  return map[role] || '/account';
}

module.exports = {
  verifyLogin,
  registerUser,
  findOrCreateGoogleUser,
  requestPasswordReset,
  resetPassword,
  redirectForRole,
  normalizeRole,
};

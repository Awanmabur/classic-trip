const identityRepository = require('../../repositories/domain/identityRepository');
const { canonicalRole, normalizePermissions } = require('../../config/accessControl');

function authVersion(user = {}) {
  const value = Number(user.authVersion || 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

async function currentUser(sessionUser = {}) {
  const id = String(sessionUser.id || '');
  const email = String(sessionUser.email || '').trim().toLowerCase();
  const filters = [];
  if (id) filters.push({ id });
  if (email) filters.push({ email });
  if (!filters.length) return null;
  const fresh = await identityRepository.users.findOne(filters.length === 1 ? filters[0] : { $or: filters });
  return fresh || null;
}

function verifiedForRole(user = {}) {
  const role = canonicalRole(user.role);
  // Customers, promoters, and company owners must be able to enter their own
  // restricted workspace to complete onboarding. Verification is enforced at
  // publishing, payout, offline-sale, and operational boundaries instead.
  if (['customer', 'promoter', 'company_admin'].includes(role)) return true;
  if (['company_employee', 'driver'].includes(role)) return true;
  return true;
}

function accountIsActive(user = {}) {
  if (!user?.id || String(user.status || 'active').toLowerCase() !== 'active') return false;
  // Membership verification controls operational dashboards, not whether a
  // correctly credentialed invitee may authenticate and view onboarding.
  if (user.accessState?.companyInactive) return false;
  return verifiedForRole(user);
}

async function accessContext(user = {}) {
  const role = canonicalRole(user.role);
  const context = { role, company: null, membership: null, companyInactive: false, membershipInactive: false };
  if (!['company_admin', 'company_employee', 'driver'].includes(role)) return context;
  if (!user.companyId) {
    context.companyInactive = true;
    return context;
  }
  context.company = await identityRepository.companies.findOne({ id: user.companyId });
  const companyStatus = String(context.company?.status || '').toLowerCase();
  const verification = String(context.company?.verificationStatus || '').toLowerCase();
  // Pending or rejected companies retain a restricted workspace so owners can
  // complete or correct verification. Suspended/blocked/inactive companies do not.
  context.companyInactive = !context.company || ['suspended', 'blocked', 'inactive'].includes(companyStatus) || ['suspended'].includes(verification);
  if (['company_employee', 'driver'].includes(role)) {
    context.membership = await identityRepository.employees.findOne({ userId: user.id, companyId: user.companyId });
    context.membershipInactive = !context.membership || String(context.membership.status || '').toLowerCase() !== 'active';
  }
  return context;
}

function applyToSession(req, user = {}, context = {}) {
  if (!req?.session || !user) return user;
  const existing = req.session.user || {};
  const membershipPermissions = normalizePermissions(context.membership?.permissions || []);
  req.session.user = {
    ...existing,
    id: user.id || existing.id,
    fullName: user.fullName || existing.fullName,
    email: user.email || existing.email,
    phone: user.phone || existing.phone,
    role: canonicalRole(user.role || existing.role),
    status: user.status || existing.status,
    companyId: user.companyId || existing.companyId || '',
    companyType: context.company?.companyType || context.company?.type || context.company?.serviceType || existing.companyType || '',
    permissions: membershipPermissions.length ? membershipPermissions : normalizePermissions(user.permissions || existing.permissions || []),
    isVerified: typeof user.isVerified === 'boolean' ? user.isVerified : existing.isVerified,
    verificationStatus: user.verificationStatus || existing.verificationStatus,
    requestedRole: user.requestedRole || '',
    roleChangeStatus: user.roleChangeStatus || '',
    authVersion: authVersion(user),
    mfaConfigured: Boolean(user.twoFactorEnabled && user.mfa?.secretEncrypted),
    accessState: {
      companyInactive: Boolean(context.companyInactive),
      membershipInactive: Boolean(context.membershipInactive),
      companyStatus: context.company?.status || '',
      companyVerificationStatus: context.company?.verificationStatus || '',
      membershipStatus: context.membership?.status || '',
    },
  };
  delete req.session.user.mfa;
  delete req.session.user.mfaSetup;
  return req.session.user;
}

async function refreshSessionUser(req) {
  const sessionUser = req?.session?.user;
  if (!sessionUser) return null;
  const fresh = await currentUser(sessionUser);
  if (!fresh) return null;
  if (authVersion(sessionUser) !== authVersion(fresh)) return null;
  const context = await accessContext(fresh);
  return applyToSession(req, fresh, context);
}

module.exports = { currentUser, accountIsActive, applyToSession, refreshSessionUser, accessContext, verifiedForRole, authVersion };

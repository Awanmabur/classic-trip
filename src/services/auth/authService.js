const bcrypt = require('bcryptjs');
const store = require('../data/demoStore');
const { env } = require('../../config/env');
const generateReferralCode = require('../../utils/generateReferralCode');

async function verifyLogin(identity, password) {
  const user = store.findUserByIdentity(identity);
  if (!user || user.status === 'suspended' || user.status === 'blocked') return null;
  if (password === env.demoPassword) return { ...user, passwordHash: undefined };
  if (user.passwordHash && await bcrypt.compare(password, user.passwordHash)) return { ...user, passwordHash: undefined };
  return null;
}

async function registerUser(payload) {
  const role = payload.role || 'customer';
  const passwordHash = payload.password ? await bcrypt.hash(payload.password, 10) : undefined;
  const user = store.upsertUser({
    fullName: payload.fullName || payload.name || 'Classic Trip User',
    email: payload.email,
    phone: payload.phone,
    role,
    passwordHash,
    status: 'active',
    isVerified: false,
    referralCode: role === 'promoter' ? generateReferralCode(payload.fullName || payload.email) : undefined,
    authProviders: { local: { enabled: Boolean(passwordHash) }, google: { enabled: false } },
  });
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

module.exports = { verifyLogin, registerUser, redirectForRole };

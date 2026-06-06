const bcrypt = require('bcryptjs');
const crypto = require('crypto');
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

async function requestPasswordReset(identity) {
  const user = store.findUserByIdentity(identity);
  if (!user) return { ok: true, sent: false };
  const token = crypto.randomBytes(24).toString('hex');
  user.passwordReset = {
    token,
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
  const user = store.state.users.find((item) => item.passwordReset?.token === token);
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

module.exports = { verifyLogin, registerUser, requestPasswordReset, resetPassword, redirectForRole };

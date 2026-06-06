const store = require('../data/demoStore');
const generateReferralCode = require('../../utils/generateReferralCode');

async function findOrCreateGoogleUser(profile, role = 'customer') {
  const email = profile.emails?.[0]?.value;
  const fullName = profile.displayName || 'Google User';
  let user = email ? store.findUserByIdentity(email) : null;
  if (user) {
    if (user.status === 'suspended' || user.status === 'blocked') {
      const error = new Error('This account is not allowed to sign in');
      error.status = 403;
      throw error;
    }
    user.authProviders = user.authProviders || {};
    user.authProviders.google = { enabled: true, googleId: profile.id };
    user.googleId = profile.id;
    user.lastLoginAt = new Date().toISOString();
    return user;
  }
  user = store.upsertUser({
    fullName,
    email,
    phone: '',
    role,
    googleId: profile.id,
    status: 'active',
    isVerified: true,
    referralCode: role === 'promoter' ? generateReferralCode(fullName) : undefined,
    authProviders: { local: { enabled: false }, google: { enabled: true, googleId: profile.id } },
    emailVerifiedAt: new Date().toISOString(),
  });
  return user;
}

module.exports = { findOrCreateGoogleUser };

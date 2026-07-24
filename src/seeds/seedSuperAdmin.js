'use strict';

const bcrypt = require('bcryptjs');
const { connectDb, mongoose } = require('../config/db');
const { env, validateEnv } = require('../config/env');
const User = require('../models/User');

function enabled(value) {
  return ['true', '1', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

async function seedSuperAdmin({ connect = true, disconnect = true } = {}) {
  validateEnv();
  if (connect && mongoose.connection.readyState !== 1) await connectDb();
  const email = String(env.superAdmin.email || '').trim().toLowerCase();
  const password = String(env.superAdmin.password || '');
  const fullName = String(env.superAdmin.fullName || 'Classic Trip Super Admin').trim();
  const phone = String(env.superAdmin.phone || '').trim();
  if (!email) throw new Error('SUPER_ADMIN_EMAIL is required');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('SUPER_ADMIN_EMAIL must be valid');
  if (password.length < 12) throw new Error('SUPER_ADMIN_PASSWORD must contain at least 12 characters');

  const existing = await User.findOne({ $or: [{ role: 'super_admin' }, { email }] });
  const resetPassword = !existing || enabled(process.env.RESET_SUPER_ADMIN_PASSWORD);
  const passwordHash = resetPassword ? await bcrypt.hash(password, 12) : existing.passwordHash;
  const values = {
    role: 'super_admin',
    fullName,
    email,
    phone,
    passwordHash,
    status: 'active',
    isVerified: true,
    verificationStatus: 'verified',
    onboardingStatus: env.platformMfaEnabled ? 'mfa_setup_required' : 'complete',
    authProviders: { ...(existing?.authProviders || {}), local: { enabled: true } },
    emailVerifiedAt: existing?.emailVerifiedAt || new Date(),
    passwordChangedAt: resetPassword ? new Date() : existing?.passwordChangedAt,
    authVersion: Number(existing?.authVersion || 0) + (resetPassword && existing ? 1 : 0),
  };
  const user = existing
    ? await User.findByIdAndUpdate(existing._id, { $set: values }, { new: true, runValidators: true })
    : await User.create(values);
  const result = { id: user.id, email: user.email, created: !existing, passwordReset: resetPassword };
  if (disconnect && mongoose.connection.readyState !== 0) await mongoose.disconnect();
  return result;
}

if (require.main === module) {
  seedSuperAdmin()
    .then((result) => { console.log(JSON.stringify(result, null, 2)); })
    .catch(async (error) => {
      console.error(error.message || error);
      if (mongoose.connection.readyState !== 0) await mongoose.disconnect().catch(() => {});
      process.exitCode = 1;
    });
}

module.exports = { seedSuperAdmin };

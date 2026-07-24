const crypto = require('crypto');
const identityRepository = require('../../repositories/domain/identityRepository');
const { env } = require('../../config/env');
const securityService = require('../security/securityService');

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const ADMIN_ROLES = new Set(['super_admin', 'admin', 'finance_admin', 'support_admin', 'operations_admin', 'content_admin']);

function clean(value) { return String(value || '').trim(); }
function isPlatformAdmin(role) { return ADMIN_ROLES.has(clean(role).toLowerCase()); }
function isConfigured(user = {}) { return Boolean(user.twoFactorEnabled && user.mfa?.secretEncrypted); }
function keyMaterial() {
  const source = env.mfaEncryptionKey || env.sessionSecret;
  if (!source) throw Object.assign(new Error('MFA encryption key is not configured'), { status: 500 });
  return crypto.createHash('sha256').update(source).digest();
}
function base32Encode(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let index = 0; index < bits.length; index += 5) {
    const chunk = bits.slice(index, index + 5).padEnd(5, '0');
    output += BASE32[parseInt(chunk, 2)];
  }
  return output;
}
function base32Decode(value) {
  const normalized = clean(value).toUpperCase().replace(/=+$/g, '').replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const character of normalized) {
    const index = BASE32.indexOf(character);
    if (index < 0) continue;
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}
function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyMaterial(), iv);
  const ciphertext = Buffer.concat([cipher.update(clean(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString('base64url')).join('.');
}
function decrypt(value) {
  const [ivValue, tagValue, cipherValue] = clean(value).split('.');
  if (!ivValue || !tagValue || !cipherValue) throw Object.assign(new Error('Stored MFA secret is invalid'), { status: 500 });
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyMaterial(), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(cipherValue, 'base64url')), decipher.final()]).toString('utf8');
}
function totp(secret, timeMs = Date.now(), stepSeconds = 30, digits = 6) {
  const counter = Math.floor(timeMs / 1000 / stepSeconds);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(value % (10 ** digits)).padStart(digits, '0');
}
function safeEqual(left, right) {
  const a = Buffer.from(clean(left));
  const b = Buffer.from(clean(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function verifyTotp(secret, code, window = 1) {
  const normalized = clean(code).replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  for (let offset = -window; offset <= window; offset += 1) {
    if (safeEqual(totp(secret, Date.now() + offset * 30000), normalized)) return true;
  }
  return false;
}
function recoveryHash(code) { return crypto.createHash('sha256').update(clean(code).toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex'); }
function recoveryCodes(count = 8) {
  return Array.from({ length: count }, () => {
    const value = crypto.randomBytes(8).toString('hex').toUpperCase();
    return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}`;
  });
}
async function userOrThrow(userId) {
  const user = await identityRepository.users.findOne({ id: clean(userId) });
  if (!user) throw Object.assign(new Error('Account not found'), { status: 404 });
  if (!isPlatformAdmin(user.role)) throw Object.assign(new Error('Multi-factor setup is restricted to platform administrators'), { status: 403 });
  return user;
}
function setupPayload(user, secret) {
  const issuer = encodeURIComponent(env.appName || 'Classic Trip');
  const account = encodeURIComponent(user.email || user.fullName || user.id);
  return {
    secret,
    otpauthUrl: `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`,
    expiresAt: user.mfaSetup?.expiresAt,
  };
}
async function beginSetup(userId) {
  const user = await userOrThrow(userId);
  if (isConfigured(user)) return { alreadyEnabled: true, user };
  if (user.mfaSetup?.secretEncrypted && user.mfaSetup?.expiresAt && new Date(user.mfaSetup.expiresAt) > new Date()) {
    return setupPayload(user, decrypt(user.mfaSetup.secretEncrypted));
  }
  const secret = base32Encode(crypto.randomBytes(20));
  user.mfaSetup = {
    secretEncrypted: encrypt(secret),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };
  user.onboardingStatus = 'mfa_setup_required';
  user.updatedAt = new Date().toISOString();
  await identityRepository.users.save(user, { id: user.id });
  await securityService.recordAudit({ action: 'auth.mfa.setup_started', actorId: user.id, actorRole: user.role, entityType: 'user', entityId: user.id, status: 'pending' });
  return setupPayload(user, secret);
}
async function confirmSetup(userId, code) {
  const user = await userOrThrow(userId);
  if (!user.mfaSetup?.secretEncrypted || !user.mfaSetup?.expiresAt || new Date(user.mfaSetup.expiresAt) <= new Date()) {
    throw Object.assign(new Error('MFA setup expired. Start setup again.'), { status: 400, code: 'mfa_setup_expired' });
  }
  const secret = decrypt(user.mfaSetup.secretEncrypted);
  if (!verifyTotp(secret, code)) throw Object.assign(new Error('The authentication code is invalid'), { status: 422, code: 'invalid_mfa_code' });
  const codes = recoveryCodes();
  user.mfa = {
    secretEncrypted: encrypt(secret),
    recoveryCodeHashes: codes.map(recoveryHash),
    enabledAt: new Date().toISOString(),
    lastVerifiedAt: new Date().toISOString(),
  };
  user.mfaSetup = {};
  user.twoFactorEnabled = true;
  user.isVerified = true;
  user.verificationStatus = 'verified';
  user.onboardingStatus = 'complete';
  user.updatedAt = new Date().toISOString();
  await identityRepository.users.save(user, { id: user.id });
  await securityService.recordAudit({ action: 'auth.mfa.enabled', actorId: user.id, actorRole: user.role, entityType: 'user', entityId: user.id, status: 'success' });
  return { user, recoveryCodes: codes };
}
async function verifyChallenge(userId, code) {
  const user = await userOrThrow(userId);
  if (!user.twoFactorEnabled || !user.mfa?.secretEncrypted) throw Object.assign(new Error('MFA is not configured for this account'), { status: 403, code: 'mfa_not_configured' });
  const normalized = clean(code);
  const secret = decrypt(user.mfa.secretEncrypted);
  let valid = verifyTotp(secret, normalized);
  let usedRecoveryCode = false;
  if (!valid) {
    const hash = recoveryHash(normalized);
    const index = (user.mfa.recoveryCodeHashes || []).findIndex((value) => safeEqual(value, hash));
    if (index >= 0) {
      user.mfa.recoveryCodeHashes.splice(index, 1);
      valid = true;
      usedRecoveryCode = true;
    }
  }
  if (!valid) throw Object.assign(new Error('The authentication code is invalid'), { status: 422, code: 'invalid_mfa_code' });
  user.mfa.lastVerifiedAt = new Date().toISOString();
  user.mfa.lastMethod = usedRecoveryCode ? 'recovery_code' : 'totp';
  user.updatedAt = new Date().toISOString();
  await identityRepository.users.save(user, { id: user.id });
  await securityService.recordAudit({ action: 'auth.mfa.challenge_passed', actorId: user.id, actorRole: user.role, entityType: 'user', entityId: user.id, status: 'success', metadata: { method: user.mfa.lastMethod } });
  const scrubbed = { ...user };
  scrubbed.mfaConfigured = true;
  delete scrubbed.passwordHash;
  delete scrubbed.mfa;
  delete scrubbed.mfaSetup;
  return scrubbed;
}

module.exports = { isPlatformAdmin, isConfigured, beginSetup, confirmSetup, verifyChallenge, verifyTotp, totp };

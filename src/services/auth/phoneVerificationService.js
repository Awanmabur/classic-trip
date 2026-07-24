const crypto = require('crypto');
const identityRepository = require('../../repositories/domain/identityRepository');
const securityService = require('../security/securityService');
const notificationService = require('../notification/notificationService');
const logger = require('../../config/logger');

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_WAIT_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

function cleanText(value, max = 180) {
  return String(value || '').replace(/<[^>]*>/g, '').trim().slice(0, max);
}

function challengeHash(userId, code, nonce) {
  return securityService.sha256(`${cleanText(userId)}:${cleanText(code, 12)}:${cleanText(nonce, 80)}`);
}

function sameHash(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

async function userFor(userId) {
  const user = await identityRepository.users.findOne({ id: cleanText(userId) });
  if (!user) {
    const error = new Error('Account not found');
    error.status = 404;
    throw error;
  }
  if (!user.phone) {
    const error = new Error('Add a phone number before requesting verification');
    error.status = 422;
    throw error;
  }
  return user;
}

async function requestCode(userId, options = {}) {
  const user = await userFor(userId);
  if (user.phoneVerifiedAt) return { ok: true, alreadyVerified: true };
  const now = Date.now();
  const current = user.phoneVerification || {};
  if (!options.force && current.resendAvailableAt && new Date(current.resendAvailableAt).getTime() > now) {
    const error = new Error('Please wait before requesting another verification code');
    error.status = 429;
    error.code = 'phone_code_rate_limited';
    throw error;
  }
  const code = String(crypto.randomInt(100000, 1000000));
  const nonce = crypto.randomBytes(16).toString('hex');
  user.phoneVerification = {
    codeHash: challengeHash(user.id, code, nonce),
    nonce,
    attempts: 0,
    requestedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CODE_TTL_MS).toISOString(),
    resendAvailableAt: new Date(now + RESEND_WAIT_MS).toISOString(),
  };
  user.phoneVerificationStatus = 'code_sent';
  user.updatedAt = new Date(now).toISOString();
  await identityRepository.users.save(user, { id: user.id });
  try {
    await notificationService.queueNotification({
      userId: user.id,
      ownerType: 'user',
      ownerId: user.id,
      channels: ['sms'],
      title: 'Classic Trip phone verification',
      message: `Your Classic Trip verification code is ${code}. It expires in 10 minutes. Do not share this code.`,
      recipient: { phone: user.phone, name: user.fullName },
      referenceType: 'phone_verification',
      referenceId: user.id,
      meta: { expiresAt: user.phoneVerification.expiresAt },
      persistedMessage: 'A phone verification code was sent. The code is not stored in notification history.',
      persistedMeta: { expiresAt: user.phoneVerification.expiresAt, codeStored: false },
    });
  } catch (error) {
    logger.error('Phone verification SMS could not be queued', { userId: user.id, error: error.message });
  }
  return { ok: true, expiresAt: user.phoneVerification.expiresAt, resendAvailableAt: user.phoneVerification.resendAvailableAt, ...(process.env.NODE_ENV === 'test' ? { testCode: code } : {}) };
}

async function verifyCode(userId, code) {
  const user = await userFor(userId);
  if (user.phoneVerifiedAt) return user;
  const challenge = user.phoneVerification || {};
  if (!challenge.codeHash || !challenge.nonce || !challenge.expiresAt) {
    const error = new Error('Request a phone verification code first');
    error.status = 422;
    error.code = 'phone_code_missing';
    throw error;
  }
  if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
    user.phoneVerificationStatus = 'expired';
    user.phoneVerification = null;
    await identityRepository.users.save(user, { id: user.id });
    const error = new Error('The phone verification code expired. Request a new code.');
    error.status = 422;
    error.code = 'phone_code_expired';
    throw error;
  }
  challenge.attempts = Number(challenge.attempts || 0) + 1;
  if (challenge.attempts > MAX_ATTEMPTS) {
    user.phoneVerificationStatus = 'locked';
    user.phoneVerification = null;
    await identityRepository.users.save(user, { id: user.id });
    const error = new Error('Too many incorrect codes. Request a new verification code.');
    error.status = 429;
    error.code = 'phone_code_locked';
    throw error;
  }
  const expected = challengeHash(user.id, code, challenge.nonce);
  if (!sameHash(expected, challenge.codeHash)) {
    user.phoneVerification = challenge;
    await identityRepository.users.save(user, { id: user.id });
    const error = new Error('The phone verification code is incorrect');
    error.status = 422;
    error.code = 'phone_code_invalid';
    throw error;
  }
  const verifiedAt = new Date().toISOString();
  user.phoneVerifiedAt = verifiedAt;
  user.phoneVerificationStatus = 'verified';
  user.phoneVerification = null;
  user.updatedAt = verifiedAt;
  await identityRepository.users.save(user, { id: user.id });
  try {
    const verificationService = require('../onboarding/verificationService');
    await verificationService.markPhoneVerifiedForUser(user.id, user.id);
  } catch (error) {
    logger.error('Phone verification checklist could not be updated', { userId: user.id, error: error.message });
  }
  return user;
}

module.exports = { requestCode, verifyCode, CODE_TTL_MS, RESEND_WAIT_MS, MAX_ATTEMPTS };

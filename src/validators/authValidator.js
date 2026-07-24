const { body } = require('express-validator');
const { MAX_PASSWORD_BYTES, passwordByteLength } = require('../services/auth/passwordPolicy');

function passwordBytes(value) {
  if (passwordByteLength(value) <= MAX_PASSWORD_BYTES) return true;
  throw new Error(`Password must not exceed ${MAX_PASSWORD_BYTES} UTF-8 bytes`);
}

const loginRules = [
  body('identity').notEmpty().trim().isLength({ max: 254 }),
  body('password').notEmpty().custom(passwordBytes),
];

const registerRules = [
  body('email').trim().isEmail().withMessage('Enter a valid email address').bail().customSanitizer((value) => String(value || '').toLowerCase()),
  body('phone').notEmpty().trim(),
  body('role').optional().trim(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters').custom(passwordBytes)
    .matches(/[A-Za-z]/).withMessage('Password must contain a letter')
    .matches(/[0-9]/).withMessage('Password must contain a number'),
  body('confirmPassword').custom((value, { req }) => {
    if (value && value !== req.body.password) throw new Error('Passwords do not match');
    return true;
  }),
  body('termsAccepted').custom((value) => {
    if (value === true || value === 'true' || value === 'on' || value === '1') return true;
    throw new Error('You must accept the terms and privacy rules');
  }),
  body().custom((value) => {
    if (String(value.fullName || '').trim()) return true;
    if (String(value.firstName || '').trim() && String(value.lastName || '').trim()) return true;
    throw new Error('Full name is required');
  }),
  body('role').optional().custom((value) => {
    if (!value || ['customer', 'promoter'].includes(String(value).toLowerCase().trim())) return true;
    throw new Error('Partners must use the verified partner onboarding page');
  }),
];

const resetPasswordRules = [
  body('token').notEmpty().isLength({ min: 32, max: 128 }),
  body('password').isLength({ min: 8 }).custom(passwordBytes)
    .matches(/[A-Za-z]/).withMessage('Password must contain a letter')
    .matches(/[0-9]/).withMessage('Password must contain a number'),
  body('confirmPassword').custom((value, { req }) => {
    if (value !== req.body.password) throw new Error('Passwords do not match');
    return true;
  }),
];

const invitationPasswordRules = [
  body('password').isLength({ min: 8 }).custom(passwordBytes)
    .matches(/[A-Za-z]/).withMessage('Password must contain a letter')
    .matches(/[0-9]/).withMessage('Password must contain a number'),
  body('confirmPassword').custom((value, { req }) => {
    if (value !== req.body.password) throw new Error('Passwords do not match');
    return true;
  }),
];

const phoneCodeRules = [
  body('code').trim().matches(/^\d{6}$/).withMessage('Enter the six-digit verification code'),
];

const mfaCodeRules = [
  body('code').trim().matches(/^(?:\d{6}|[A-Za-z0-9-]{16,24})$/).withMessage('Enter a six-digit authenticator code or recovery code'),
];

module.exports = { loginRules, registerRules, resetPasswordRules, invitationPasswordRules, phoneCodeRules, mfaCodeRules };

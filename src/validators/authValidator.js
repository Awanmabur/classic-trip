const { body } = require('express-validator');

const loginRules = [
  body('identity').notEmpty().trim(),
  body('password').notEmpty(),
];

const registerRules = [
  body('email').isEmail().normalizeEmail(),
  body('phone').notEmpty().trim(),
  body('password').isLength({ min: 6 }),
  body('confirmPassword').custom((value, { req }) => {
    if (value && value !== req.body.password) throw new Error('Passwords do not match');
    return true;
  }),
  body().custom((value) => {
    if (String(value.fullName || '').trim()) return true;
    if (String(value.firstName || '').trim() && String(value.lastName || '').trim()) return true;
    throw new Error('Full name is required');
  }),
];

module.exports = { loginRules, registerRules };

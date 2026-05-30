const { body } = require('express-validator');

const loginRules = [body('identity').notEmpty().trim(), body('password').notEmpty()];
const registerRules = [body('email').isEmail().normalizeEmail(), body('fullName').notEmpty().trim(), body('password').isLength({ min: 6 })];

module.exports = { loginRules, registerRules };
